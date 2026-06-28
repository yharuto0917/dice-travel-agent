import type { RateLimitStatus, RateScope } from "@repo/shared";
import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "../db/client";
import { rateLimits } from "../db/schema";

/**
 * スコープ別の1日あたり上限（Cookie 単位, #17）。
 * - plan: 計画生成は 2回/日
 * - chat: 常駐チャットは 20回/日
 */
export const RATE_LIMITS: Record<RateScope, number> = {
  plan: 2,
  chat: 20,
};

/** JST（UTC+9）。日次リセットの境界はこのオフセットで判定する。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

type Db = ReturnType<typeof getDb>;

/**
 * JST 基準の "YYYY-MM-DD" を返す。レートリミットの日次カウンタのキーに使う。
 * UTC からの単純なオフセットで JST の暦日を求める（DST が無いため安全）。
 */
export function jstDayKey(now: Date): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 次に当日カウンタがリセットされる時刻（翌 JST 00:00）を UTC の ISO 文字列で返す。
 * 超過時 UX の「次回可能時刻」表示に使う。
 */
export function nextResetAt(now: Date): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  // 翌日 0:00(JST) を UTC 実時刻へ戻す（JST の暦値 -9h が UTC 実時刻）。
  const nextJstMidnight = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 1);
  return new Date(nextJstMidnight - JST_OFFSET_MS).toISOString();
}

/** 使用回数からレート制限状況（残回数・リセット時刻）を組み立てる純粋関数。 */
export function buildStatus(scope: RateScope, used: number, now: Date): RateLimitStatus {
  const limit = RATE_LIMITS[scope];
  return {
    scope,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetAt: nextResetAt(now),
  };
}

/** 消費判定の結果。`allowed=false` のとき呼び出し側は 429 を返す。 */
export type RateLimitResult = RateLimitStatus & { allowed: boolean };

/**
 * 1回分を原子的に消費する（#17）。
 *
 * `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 WHERE count < limit RETURNING count`
 * を1文で発行する。上限未満なら +1 して新しい値を返し、上限到達済みなら
 * 更新が発火せず RETURNING が空になる。これにより「拒否されたリクエストで
 * カウンタを無駄に膨張させない」かつ「チェックと加算の競合を避ける」を両立する。
 */
export async function consumeRateLimit(
  db: Db,
  clientId: string,
  scope: RateScope,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const limit = RATE_LIMITS[scope];
  const day = jstDayKey(now);
  const updatedAt = now.toISOString();

  const updated = await db
    .insert(rateLimits)
    .values({ clientId, scope, day, count: 1, updatedAt })
    .onConflictDoUpdate({
      target: [rateLimits.clientId, rateLimits.scope, rateLimits.day],
      set: { count: sql`${rateLimits.count} + 1`, updatedAt },
      setWhere: sql`${rateLimits.count} < ${limit}`,
    })
    .returning({ count: rateLimits.count });

  const [row] = updated;
  if (row) {
    return { ...buildStatus(scope, row.count, now), allowed: true };
  }

  // 上限到達: 更新は発火していない。現在値を読み出して残回数 0 を返す。
  const used = await readUsed(db, clientId, scope, day);
  return { ...buildStatus(scope, used, now), allowed: false };
}

/** 消費せずに現在のレート制限状況を読み出す（GET /rate-limits 用, #17）。 */
export async function peekRateLimit(
  db: Db,
  clientId: string,
  scope: RateScope,
  now: Date = new Date(),
): Promise<RateLimitStatus> {
  const used = await readUsed(db, clientId, scope, jstDayKey(now));
  return buildStatus(scope, used, now);
}

/** 当日（JST）の使用回数を読み出す。レコードが無ければ 0。 */
async function readUsed(db: Db, clientId: string, scope: RateScope, day: string): Promise<number> {
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(
      and(eq(rateLimits.clientId, clientId), eq(rateLimits.scope, scope), eq(rateLimits.day, day)),
    );
  return row?.count ?? 0;
}
