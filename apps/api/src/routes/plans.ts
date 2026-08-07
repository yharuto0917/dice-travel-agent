import { zValidator } from "@hono/zod-validator";
import {
  ChatHistoryQuerySchema,
  type ChatHistoryResponse,
  type ChatMessage,
  type CreateChatAccessResponse,
  CreatePlanRequestSchema,
  type CreatePlanResponse,
  type GetPlanResponse,
  type PlanVersionMeta,
  RestorePlanRequestSchema,
} from "@repo/shared";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { setCookie } from "hono/cookie";
import { PlanRevisionConflictError, persistPlanRevision } from "../agents/chat/plan-persistence";
import { diffPlans } from "../agents/validation/diff";
import { getDb } from "../db/client";
import { chatMessages, type PlanRow, plans, planVersions } from "../db/schema";
import type { AppEnv } from "../env";
import {
  chatAccessCookieName,
  chatAccessCookiePath,
  signChatAccessToken,
} from "../lib/chat-access-token";
import { consumeRateLimit } from "../lib/rate-limit";
import { rateLimited } from "../lib/rate-limit-response";
import { TURNSTILE_TOKEN_HEADER, verifyTurnstile } from "../lib/turnstile";

const plansRoute = new Hono<AppEnv>();

/** chat access token を JS から読めない、計画専用パスの Cookie として発行する。 */
function setChatAccessCookie(
  c: Context<AppEnv>,
  planId: string,
  access: { token: string; expiresAt: string },
): void {
  setCookie(c, chatAccessCookieName(planId), access.token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: chatAccessCookiePath(planId),
    expires: new Date(access.expiresAt),
  });
}

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

/** Turnstile 検証失敗の共通レスポンス（生成・chat access の双方で同じ案内を返す）。 */
function turnstileFailed(c: Context<AppEnv>, codes: string[]) {
  return c.json(
    {
      error: "ボット対策の確認に失敗しました。ページを再読み込みしてお試しください。",
      code: "turnstile_failed" as const,
      errorCodes: codes,
    },
    403,
  );
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

  // 二段防御の前段（#49）: 人間性検証。高コストな生成を起動する前に Turnstile を検証し、
  // 失敗は 403 で拒否する。レートリミット（#17・回数制御）より前に置く。
  const turnstile = await verifyTurnstile(
    c.env,
    c.req.header(TURNSTILE_TOKEN_HEADER),
    c.req.header("cf-connecting-ip"),
  );
  if (!turnstile.success) return turnstileFailed(c, turnstile.errorCodes);

  // 二段防御の後段（#17）: 計画生成は Cookie 単位で 2回/日。原子的にカウントし、超過は 429 で拒否する。
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

  // このリクエストは既に Turnstile を通っているため、しおり到達時に同じ人へ再チャレンジを
  // 要求しないよう、ここで常駐チャット（#20）の接続トークンも発行する。
  const access = await signChatAccessToken(c.env.CHAT_ACCESS_SECRET, { planId, clientId });
  setChatAccessCookie(c, planId, access);

  return c.json({
    id: planId,
    expiresAt: access.expiresAt,
  } satisfies CreatePlanResponse);
});

/**
 * 常駐チャットの接続トークンを発行する（#20）。
 *
 * Home の作成履歴や URL 直開きなど、生成フローを経ずに入る経路向け。
 * 所有者確認 → Turnstile 検証の順に通ったときだけ発行する。順序が逆だと、
 * 他人の planId に対して Turnstile を解かせるだけで存在有無が漏れる。
 */
plansRoute.post("/:id/chat-access", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const clientId = c.get("clientId");

  const row = await loadOwnedPlan(db, id, clientId);
  if (!row) return c.json({ error: "plan not found" }, 404);

  const turnstile = await verifyTurnstile(
    c.env,
    c.req.header(TURNSTILE_TOKEN_HEADER),
    c.req.header("cf-connecting-ip"),
  );
  if (!turnstile.success) return turnstileFailed(c, turnstile.errorCodes);

  const access = await signChatAccessToken(c.env.CHAT_ACCESS_SECRET, { planId: id, clientId });
  setChatAccessCookie(c, id, access);
  return c.json({
    expiresAt: access.expiresAt,
  } satisfies CreateChatAccessResponse);
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

  try {
    await persistPlanRevision(c.env, {
      plan: target.plan,
      row,
      label: `restore元(v${row.version})`,
    });
  } catch (error) {
    if (error instanceof PlanRevisionConflictError) {
      return c.json({ error: "plan was updated; reload and retry" }, 409);
    }
    throw error;
  }

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

/**
 * 履歴ページングの cursor。新規保存はミリ秒かつ単調増加の createdAt を使う。
 * id は旧データに同一秒の行がある場合にも全順序を作るための第2キー。
 */
export type ChatCursor = { createdAt: string; id: string };

/**
 * cursor を URL に載せられる不透明な文字列へ変換する。
 *
 * 将来 cursor に項目を足せるよう JSON オブジェクトのまま不透明化する。
 */
export function encodeCursor(cursor: ChatCursor): string {
  return btoa(JSON.stringify([cursor.createdAt, cursor.id]));
}

/** cursor をデコードする。壊れていれば null（先頭ページ扱い）。 */
export function decodeCursor(value: string | undefined): ChatCursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(atob(value));
    if (!Array.isArray(parsed)) return null;
    const [createdAt, id] = parsed as unknown[];
    if (typeof createdAt !== "string" || typeof id !== "string") return null;
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * 計画に紐づくチャット履歴を取得する（#20）。
 *
 * ライブ会話は Chat Agent の SQLite が正本で、ここはそれより古い分を読み足すための
 * 長期アーカイブ。全件返すと会話が伸びるほど初期表示が重くなるため cursor ページングにする。
 * 取得は新しい順、レスポンスは表示順（古い順）で返す。
 */
plansRoute.get("/:id/chat", zValidator("query", ChatHistoryQuerySchema), async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const row = await loadOwnedPlan(db, id, c.get("clientId"));
  if (!row) return c.json({ error: "plan not found" }, 404);

  const { limit, before, beforeMessageId } = c.req.valid("query");
  let cursor = decodeCursor(before);

  // 初回は DO が現在保持している最古の live message より前から始める。
  // D1 の最新ページを一度返して client 側で全件重複除外する形だと、可視行が増えないまま
  // cursor だけ進み、上端検知が再発火せず過去へ到達できない。
  if (!cursor && beforeMessageId) {
    const [boundary] = await db
      .select({ createdAt: chatMessages.createdAt, id: chatMessages.id })
      .from(chatMessages)
      .where(and(eq(chatMessages.planId, id), eq(chatMessages.id, beforeMessageId)));
    if (boundary) cursor = boundary;
  }

  // 次ページの有無を1クエリで判定するため limit+1 件取り、超過分は返さず cursor 生成に使う。
  const rows = await db
    .select()
    .from(chatMessages)
    .where(
      cursor
        ? and(
            eq(chatMessages.planId, id),
            or(
              lt(chatMessages.createdAt, cursor.createdAt),
              and(eq(chatMessages.createdAt, cursor.createdAt), lt(chatMessages.id, cursor.id)),
            ),
          )
        : eq(chatMessages.planId, id),
    )
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const oldest = page.at(-1);

  return c.json({
    // 取得は新しい順。表示は古い順なので反転して返す。
    messages: page.map(toChatMessage).reverse(),
    nextCursor: hasMore && oldest ? encodeCursor(oldest) : null,
  } satisfies ChatHistoryResponse);
});

export default plansRoute;
