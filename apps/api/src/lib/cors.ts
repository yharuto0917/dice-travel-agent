/**
 * CORS の許可判定とヘッダ組み立て（#6 / #20）。
 *
 * Hono 配下のルートと `/agents/*`（Agents SDK が処理するため Hono を経由しない）の
 * 双方から使う。許可リストが二重管理になると、片方だけ通って CORS で落ちる。
 */

import type { Bindings } from "../env";

/** 開発時に許可するフロントのオリジン（本番は WEB_ORIGIN で指定）。 */
export const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8787",
  "http://localhost:8788",
  "http://localhost:8789",
];

/** 資格情報付きリクエストを許可するオリジンか。 */
export function isAllowedOrigin(origin: string, env: Bindings): boolean {
  if (env.WEB_ORIGIN && origin === env.WEB_ORIGIN) return true;
  return DEV_ORIGINS.includes(origin);
}

/**
 * `/agents/*` に付ける CORS ヘッダ。許可外オリジン・非ブラウザからの呼び出しでは undefined。
 *
 * Agents SDK の `cors: true` は `Access-Control-Allow-Origin: *` を返すが、ワイルドカードは
 * `credentials: "include"` のリクエストではブラウザに拒否される。接続許可 Cookie を送るには
 * オリジンをそのまま返し、`Access-Control-Allow-Credentials` を添える必要がある。
 * 許可外には何も付けない（= ブラウザ側で遮断させる）。
 */
export function agentCorsHeaders(
  request: Request,
  env: Bindings,
): Record<string, string> | undefined {
  const origin = request.headers.get("origin");
  if (!origin || !isAllowedOrigin(origin, env)) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
    // 資格情報付きでは "*" がワイルドカードとして解釈されないため、実際に使う値を列挙する。
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** レスポンスへ CORS ヘッダを付け直す（ヘッダ未確定＝許可外ならそのまま返す）。 */
export function withCors(
  response: Response,
  headers: Record<string, string> | undefined,
): Response {
  if (!headers) return response;
  const next = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) next.headers.set(key, value);
  return next;
}
