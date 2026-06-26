import { zValidator } from "@hono/zod-validator";
import {
  CreatePlanRequestSchema,
  type GetPlanResponse,
  type PlanVersionMeta,
  RestorePlanRequestSchema,
} from "@repo/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { diffPlans } from "../agents/validation/diff";
import { getDb } from "../db/client";
import { type PlanRow, plans, planVersions } from "../db/schema";
import type { AppEnv } from "../env";

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

/** 指定 version の計画 JSON を解決する（現行版なら plans.plan）。 */
async function resolvePlanAtVersion(
  db: ReturnType<typeof getDb>,
  row: PlanRow,
  version: number,
): Promise<StoredPlan> {
  if (version === row.version) return row.plan ?? null;
  const [v] = await db
    .select()
    .from(planVersions)
    .where(and(eq(planVersions.planId, row.id), eq(planVersions.version, version)));
  return v?.plan ?? null;
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
  if (!a || !b) return c.json({ error: "version not found" }, 404);

  return c.json({ diff: diffPlans(a, b) });
});

/** バージョン復元: 現行を退避し、指定 version の plan を現行へ戻す。 */
plansRoute.post("/:id/restore", zValidator("json", RestorePlanRequestSchema), async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const row = await loadOwnedPlan(db, id, c.get("clientId"));
  if (!row) return c.json({ error: "plan not found" }, 404);

  const { version } = c.req.valid("json");
  const target = await resolvePlanAtVersion(db, row, version);
  if (!target) return c.json({ error: "version not found" }, 404);

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
    .set({ plan: target, version: nextVersion, updatedAt: new Date().toISOString() })
    .where(eq(plans.id, id));

  const updated = await loadOwnedPlan(db, id, c.get("clientId"));
  return c.json(updated ? toGetPlanResponse(updated) : { error: "not found" });
});

export default plansRoute;
