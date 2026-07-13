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
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

/**
 * 画像URLを表示用に解決する（#18）。
 *
 * 生成画像は API の `/assets/*` から配信されるが、保存時に埋め込まれるオリジンは
 * 生成した環境（本番/ローカル）に固定される。一方で実体は「生成した API の R2」にあるため、
 * 別環境のフロントから開くとオリジンが食い違い 404 になる。パスが `/assets/` で始まるURLは、
 * 保存オリジンを捨てて**現在フロントが使う API ベースURL**から取り直すことで、この不整合を防ぐ。
 * 外部（Unsplash 等）の絶対URLはそのまま返す。パース不能な値も素通しする。
 */
export function resolveAssetUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.pathname.startsWith("/assets/")) return `${API_BASE_URL}${u.pathname}${u.search}`;
    return url;
  } catch {
    return url;
  }
}

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

import type {
  ChatMessage,
  CreatePlanRequest,
  GetPlanResponse,
  PlanDiff,
  PlanVersionMeta,
  RateLimitStatus,
  RateLimitsResponse,
} from "@repo/shared";

/**
 * レート制限（429）超過を表すエラー（#17）。
 * `status` に残回数・次回可能時刻（resetAt）を持つため、UI で案内できる。
 */
export class RateLimitError extends Error {
  readonly status: RateLimitStatus;
  constructor(status: RateLimitStatus) {
    super("rate limited");
    this.name = "RateLimitError";
    this.status = status;
  }
}

/**
 * Turnstile（#49）検証失敗を表すエラー。`message` をそのまま UI 案内に使える。
 */
export class TurnstileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnstileError";
  }
}

/** Turnstile トークンを載せる HTTP ヘッダ名（API 側の定数と一致させる）。 */
const TURNSTILE_TOKEN_HEADER = "cf-turnstile-response";

/**
 * レスポンスのステータスを検査し、レート制限(429)/Turnstile(403)を専用エラーへ変換する。
 * それ以外の失敗は汎用 Error。
 */
async function throwForStatus(res: Response): Promise<void> {
  if (res.status === 429) {
    const body = (await res.json()) as RateLimitStatus;
    throw new RateLimitError(body);
  }
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new TurnstileError(body.error ?? "ボット対策の確認に失敗しました。");
  }
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * 旅の条件と行き先を元に新しい計画を作成する。
 * 二段防御: Turnstile トークン(#49)を添付して送り、API 側で人間性検証 → レート制限(#17)を通す。
 */
export async function createPlan(
  data: CreatePlanRequest,
  turnstileToken?: string | null,
): Promise<{ id: string }> {
  const headers: Record<string, string> = {};
  if (turnstileToken) headers[TURNSTILE_TOKEN_HEADER] = turnstileToken;

  const res = await apiFetch("/plans", {
    method: "POST",
    body: JSON.stringify(data),
    headers,
  });
  await throwForStatus(res);
  return res.json() as Promise<{ id: string }>;
}

/** 当日（JST）のスコープ別レート制限の残回数・リセット時刻を取得する（#17）。 */
export function getRateLimits(): Promise<RateLimitsResponse> {
  return apiJson<RateLimitsResponse>("/rate-limits");
}

/** 計画のチャット履歴を取得する（#20）。 */
export function getChatMessages(id: string): Promise<{ messages: ChatMessage[] }> {
  return apiJson<{ messages: ChatMessage[] }>(`/plans/${id}/chat`);
}

/** チャットメッセージを送信する（チャット 20回/日のレート制限あり, #17）。 */
export async function sendChatMessage(
  id: string,
  content: string,
): Promise<{ message: ChatMessage }> {
  const res = await apiFetch(`/plans/${id}/chat`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  await throwForStatus(res);
  return res.json() as Promise<{ message: ChatMessage }>;
}

/** 計画を取得する（しおり表示・D1 が単一の真実, #16）。 */
export function getPlan(id: string): Promise<GetPlanResponse> {
  return apiJson<GetPlanResponse>(`/plans/${id}`);
}

/** 計画のバージョン履歴（メタのみ）を取得する。 */
export function getPlanVersions(id: string): Promise<{ versions: PlanVersionMeta[] }> {
  return apiJson<{ versions: PlanVersionMeta[] }>(`/plans/${id}/versions`);
}

/** 2版間の差分を取得する。 */
export function getPlanDiff(id: string, from: number, to: number): Promise<{ diff: PlanDiff }> {
  return apiJson<{ diff: PlanDiff }>(`/plans/${id}/diff?from=${from}&to=${to}`);
}

/** 指定バージョンを現行へ復元する。 */
export function restorePlanVersion(id: string, version: number): Promise<GetPlanResponse> {
  return apiJson<GetPlanResponse>(`/plans/${id}/restore`, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}
