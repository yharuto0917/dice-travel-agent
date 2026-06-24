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
 *
 * `Content-Type: application/json` は文字列ボディ（JSON 文字列）の時だけ付ける。
 * - GET 等のボディ無しに付けると CORS の単純リクエスト条件を外し、不要なプリフライトを誘発する。
 * - FormData / Blob 等はブラウザが boundary 付きで自動設定するため触らない。
 * - 既に呼び出し側が指定していれば上書きしない。
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (typeof init?.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
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

import type { CreatePlanRequest } from "@repo/shared";

/** 旅の条件と行き先を元に新しい計画を作成する */
export function createPlan(data: CreatePlanRequest): Promise<{ id: string }> {
  return apiJson<{ id: string }>("/plans", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
