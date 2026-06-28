import type { Bindings } from "../env";

/** Turnstile トークンを載せる HTTP ヘッダ名（Cloudflare 標準のフィールド名に合わせる）。 */
export const TURNSTILE_TOKEN_HEADER = "cf-turnstile-response";

/** Cloudflare Turnstile のトークン検証エンドポイント。 */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Turnstile 検証結果。`bypassed` はローカル開発などで検証を省略したことを示す。 */
export interface TurnstileVerifyResult {
  success: boolean;
  bypassed: boolean;
  errorCodes: string[];
}

/**
 * siteverify の JSON レスポンスを検証結果へ変換する純粋関数。
 * `success` と `error-codes` のみを取り出し、想定外の形でも安全に倒す。
 */
export function interpretSiteverify(json: unknown): TurnstileVerifyResult {
  const obj = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  const rawCodes = obj["error-codes"];
  const errorCodes = Array.isArray(rawCodes)
    ? rawCodes.filter((c): c is string => typeof c === "string")
    : [];
  return { success: obj.success === true, bypassed: false, errorCodes };
}

/**
 * Cloudflare Turnstile のトークンを検証する（#49・ボット/乱用対策の人間性検証）。
 *
 * 高コストなプラン生成の前段に置き、`success` のときのみ後続（レートリミット→生成）へ進める。
 * `TURNSTILE_SECRET_KEY` 未設定時は検証をバイパスする（ローカル開発で通常フローを阻害しないため）。
 * 本番では secret を必ず設定し、未設定運用にならないよう README/AGENTS に明記する。
 */
export async function verifyTurnstile(
  env: Bindings,
  token: string | undefined,
  remoteIp?: string,
): Promise<TurnstileVerifyResult> {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { success: true, bypassed: true, errorCodes: [] };
  }
  if (!token) {
    return { success: false, bypassed: false, errorCodes: ["missing-input-response"] };
  }

  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  if (remoteIp) form.append("remoteip", remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
    return interpretSiteverify(await res.json());
  } catch {
    // siteverify への到達失敗は人間性を確認できないため fail-closed（拒否）にする。
    return { success: false, bypassed: false, errorCodes: ["internal-error"] };
  }
}
