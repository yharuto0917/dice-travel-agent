import type { RateLimitStatus } from "@repo/shared";
import type { Context } from "hono";
import type { AppEnv } from "../env";

/** スコープ別の超過時メッセージ。フロントの案内文と整合させる。 */
const SCOPE_LABEL: Record<RateLimitStatus["scope"], string> = {
  plan: "本日の計画作成の上限に達しました",
  chat: "本日のチャットの上限に達しました",
};

/**
 * レート制限超過の 429 レスポンスを生成する（#17）。
 * フロントが残回数・次回可能時刻を案内できるよう、状況をそのまま JSON で返す。
 */
export function rateLimited(c: Context<AppEnv>, status: RateLimitStatus) {
  // consumeRateLimit の戻り値（allowed 付き）が渡ってもクライアントへは漏らさない。
  const { scope, limit, used, remaining, resetAt } = status;
  return c.json(
    {
      error: SCOPE_LABEL[scope],
      code: "rate_limited" as const,
      scope,
      limit,
      used,
      remaining,
      resetAt,
    },
    429,
  );
}
