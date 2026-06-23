/**
 * API（Hono / Cloudflare Workers）呼び出しの共通クライアント。
 *
 * 認証は行わず、サーバが発行する署名付き Cookie（匿名クライアントID, #6）で
 * クライアントを識別する。Cookie を送受信するため、すべての呼び出しを
 * `credentials: "include"` で行うのが要点。
 */

/**
 * API のベースURL。本番は `NEXT_PUBLIC_API_BASE_URL` で指定し、
 * 未設定（ローカル開発）では wrangler dev の既定ポート 8787 を使う。
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

/**
 * fetch のラッパー。Cookie を確実に送受信できるよう `credentials: "include"` を強制する。
 * パスは "/me" のように先頭スラッシュ付きで渡す。
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

/** API レスポンスを JSON として取得する薄いヘルパー。 */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** 現在の匿名クライアントID（Cookie 未発行なら初回アクセスで発行される, #6）。 */
export function fetchClientId(): Promise<{ clientId: string }> {
  return apiJson<{ clientId: string }>("/me");
}
