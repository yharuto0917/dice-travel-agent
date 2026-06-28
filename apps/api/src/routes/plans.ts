import { zValidator } from "@hono/zod-validator";
import {
  type ChatMessage,
  CreatePlanRequestSchema,
  type GetPlanResponse,
  type PlanVersionMeta,
  RestorePlanRequestSchema,
  SendChatMessageRequestSchema,
} from "@repo/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { diffPlans } from "../agents/validation/diff";
import { getDb } from "../db/client";
import { chatMessages, type PlanRow, plans, planVersions } from "../db/schema";
import type { AppEnv } from "../env";
import { consumeRateLimit } from "../lib/rate-limit";
import { rateLimited } from "../lib/rate-limit-response";

const plansRoute = new Hono<AppEnv>();

/** 自分（clientId）が所有する計画行を取得する。無ければ null。 */
async function loadOwnedPlan(
  db: ReturnType<typeof getDb>,
  id: string,
  clientId: string,
): Promise<PlanRow | null> {
  const [row] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, id), eq(plans.clientId, clientId)));
  return row ?? null;
}

/** 計画行を取得APIのレスポンス形へ整形する。 */
function toGetPlanResponse(row: PlanRow): GetPlanResponse {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    destinationPref: row.destinationPref,
    conditions: row.conditions ?? null,
    plan: row.plan ?? null,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

plansRoute.post("/", zValidator("json", CreatePlanRequestSchema), async (c) => {
  const db = getDb(c.env);
  const body = c.req.valid("json");
  const clientId = c.get("clientId");

  // 計画生成は Cookie 単位で 2回/日。生成開始時に原子的にカウントし、超過は 429 で拒否する。
  const limit = await consumeRateLimit(db, clientId, "plan");
  if (!limit.allowed) return rateLimited(c, limit);

  const planId = crypto.randomUUID();

  await db.insert(plans).values({
    id: planId,
    clientId,
    status: "draft",
    destinationPrefCode: body.destinationPrefCode,
    destinationPref: body.destinationPref,
    conditions: body.conditions,
  });

  return c.json({ id: planId });
});

/** 計画の取得（しおり表示・D1 が単一の真実）。 */
plansRoute.get("/:id", async (c) => {
  const db = getDb(c.env);
  const row = await loadOwnedPlan(db, c.req.param("id"), c.get("clientId"));
  if (!row) return c.json({ error: "plan not found" }, 404);
  return c.json(toGetPlanResponse(row));
});

/** バージョン履歴（メタのみ。plan 本体は含めない）。 */
plansRoute.get("/:id/versions", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const row = await loadOwnedPlan(db, id, c.get("clientId"));
  if (!row) return c.json({ error: "plan not found" }, 404);

  const rows = await db
    .select({
      id: planVersions.id,
      planId: planVersions.planId,
      version: planVersions.version,
      label: planVersions.label,
      createdAt: planVersions.createdAt,
    })
    .from(planVersions)
    .where(eq(planVersions.planId, id))
    .orderBy(desc(planVersions.version));

  const versions: PlanVersionMeta[] = rows.map((r) => ({
    id: r.id,
    planId: r.planId,
    version: r.version,
    label: r.label,
    createdAt: r.createdAt,
  }));
  return c.json({ versions });
});

/** 計画 plan カラムの型（TravelPlanDraft | null）。 */
type StoredPlan = PlanRow["plan"];

/**
 * 指定 version の解決結果。`found` は version レコードの存在、`plan` はその内容。
 * 「version が存在しない」と「存在するが plan が null」を呼び出し側で区別できるよう
 * 両者を分けて返す。
 */
type ResolvedVersion = { found: boolean; plan: StoredPlan };

/** 指定 version の計画 JSON を解決する（現行版なら plans.plan）。 */
async function resolvePlanAtVersion(
  db: ReturnType<typeof getDb>,
  row: PlanRow,
  version: number,
): Promise<ResolvedVersion> {
  if (version === row.version) return { found: true, plan: row.plan ?? null };
  const [v] = await db
    .select()
    .from(planVersions)
    .where(and(eq(planVersions.planId, row.id), eq(planVersions.version, version)));
  return { found: v != null, plan: v?.plan ?? null };
}

/** 2版間の差分（?from=&to= はバージョン番号。現行版も指定可）。 */
plansRoute.get("/:id/diff", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const row = await loadOwnedPlan(db, id, c.get("clientId"));
  if (!row) return c.json({ error: "plan not found" }, 404);

  const from = Number(c.req.query("from"));
  const to = Number(c.req.query("to"));
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return c.json({ error: "from/to must be integer versions" }, 400);
  }

  const [a, b] = await Promise.all([
    resolvePlanAtVersion(db, row, from),
    resolvePlanAtVersion(db, row, to),
  ]);
  if (!a.found || !b.found) return c.json({ error: "version not found" }, 404);
  // version は存在するが plan 本体が無い（null）場合は差分対象が無い旨を 409 で返す。
  if (!a.plan || !b.plan) return c.json({ error: "version has no plan content" }, 409);

  return c.json({ diff: diffPlans(a.plan, b.plan) });
});

/** バージョン復元: 現行を退避し、指定 version の plan を現行へ戻す。 */
plansRoute.post("/:id/restore", zValidator("json", RestorePlanRequestSchema), async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const row = await loadOwnedPlan(db, id, c.get("clientId"));
  if (!row) return c.json({ error: "plan not found" }, 404);

  const { version } = c.req.valid("json");
  const target = await resolvePlanAtVersion(db, row, version);
  if (!target.found) return c.json({ error: "version not found" }, 404);
  if (!target.plan) return c.json({ error: "version has no plan content" }, 409);

  // 現行 plan を退避してから復元する（履歴を失わない）。
  if (row.plan) {
    await db.insert(planVersions).values({
      id: crypto.randomUUID(),
      planId: id,
      version: row.version,
      plan: row.plan,
      label: `restore元(v${row.version})`,
    });
  }

  const nextVersion = row.version + 1;
  await db
    .update(plans)
    .set({ plan: target.plan, version: nextVersion, updatedAt: new Date().toISOString() })
    .where(eq(plans.id, id));

  const updated = await loadOwnedPlan(db, id, c.get("clientId"));
  return c.json(updated ? toGetPlanResponse(updated) : { error: "not found" });
});

/** チャットメッセージ行をレスポンス形へ整形する。 */
function toChatMessage(row: typeof chatMessages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    planId: row.planId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
  };
}

/** 計画に紐づくチャット履歴を取得する（古い順）。 */
plansRoute.get("/:id/chat", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const row = await loadOwnedPlan(db, id, c.get("clientId"));
  if (!row) return c.json({ error: "plan not found" }, 404);

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.planId, id))
    .orderBy(asc(chatMessages.createdAt));
  return c.json({ messages: rows.map(toChatMessage) });
});

/**
 * チャット送信（#17/#20）。Cookie 単位で 20回/日に制限する。
 * 送信時に chat カウンタを原子的にインクリメントし、超過は 429 で拒否する。
 * 本エンドポイントはユーザー発話の永続化までを担い、AI 応答生成は #20 で実装する。
 */
plansRoute.post("/:id/chat", zValidator("json", SendChatMessageRequestSchema), async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const clientId = c.get("clientId");
  const row = await loadOwnedPlan(db, id, clientId);
  if (!row) return c.json({ error: "plan not found" }, 404);

  const limit = await consumeRateLimit(db, clientId, "chat");
  if (!limit.allowed) return rateLimited(c, limit);

  const [saved] = await db
    .insert(chatMessages)
    .values({
      id: crypto.randomUUID(),
      planId: id,
      role: "user",
      content: c.req.valid("json").content,
    })
    .returning();
  if (!saved) return c.json({ error: "failed to save message" }, 500);
  return c.json({ message: toChatMessage(saved) }, 201);
});

export default plansRoute;
