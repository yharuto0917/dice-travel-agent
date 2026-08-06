/**
 * 常駐チャット（#20）の接続許可トークン。
 *
 * Chat Agent は `/agents/travel-chat-agent/{planId}` の WebSocket で公開されるため、
 * Hono の Cookie ミドルウェアを経由しない。所有者確認と Turnstile 検証を通した時にだけ
 * このトークンを発行し、接続時に Hono の認可ゲートで検証する。
 *
 * WebSocket の URL に Cookie の実値や secret を載せないよう、planId / clientId / 期限を
 * 含む payload を HMAC-SHA256 で署名した独立トークンにする。
 */

/** トークンの用途。他の署名値をこのゲートへ流用できないよう payload に固定で含める。 */
const TOKEN_PURPOSE = "travel-chat";

/** 既定の有効期間（2時間）。しおり閲覧セッションを賄える程度に短く保つ。 */
export const CHAT_ACCESS_TTL_SEC = 2 * 60 * 60;

/** 署名対象の payload。 */
export interface ChatAccessTokenPayload {
  purpose: typeof TOKEN_PURPOSE;
  planId: string;
  clientId: string;
  /** 失効時刻（UNIX 秒）。 */
  exp: number;
}

/** 検証結果。失敗理由は UI へは出さずログ・ステータス選択にだけ使う。 */
export type VerifyChatAccessResult =
  | { valid: true; payload: ChatAccessTokenPayload }
  | { valid: false; reason: "malformed" | "bad_signature" | "expired" | "purpose_mismatch" };

/** base64url エンコード（パディング無し）。 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url デコード。不正な入力では null を返す。 */
function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * chat access token を発行する。
 * `nowSec` はテストから固定できるよう引数にしている。
 */
export async function signChatAccessToken(
  secret: string,
  input: { planId: string; clientId: string },
  nowSec: number = Math.floor(Date.now() / 1000),
  ttlSec: number = CHAT_ACCESS_TTL_SEC,
): Promise<{ token: string; expiresAt: string }> {
  if (!secret) throw new Error("CHAT_ACCESS_SECRET is not configured");

  const payload: ChatAccessTokenPayload = {
    purpose: TOKEN_PURPOSE,
    planId: input.planId,
    clientId: input.clientId,
    exp: nowSec + ttlSec,
  };

  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));

  return {
    token: `${body}.${toBase64Url(new Uint8Array(signature))}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

/**
 * chat access token を検証する。
 *
 * 署名 → 期限 → purpose の順に確認する。呼び出し側は加えて
 * 「payload.planId が URL の planId と一致するか」「payload.clientId が計画の所有者か」を
 * 必ず突き合わせること（このトークン単体は planId を主張するだけで所有権は証明しない）。
 */
export async function verifyChatAccessToken(
  secret: string,
  token: string | undefined | null,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<VerifyChatAccessResult> {
  if (!secret) throw new Error("CHAT_ACCESS_SECRET is not configured");
  if (!token) return { valid: false, reason: "malformed" };

  const [body, signature] = token.split(".");
  if (!body || !signature) return { valid: false, reason: "malformed" };

  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return { valid: false, reason: "malformed" };

  // 署名検証は crypto.subtle.verify に任せる（定数時間比較）。
  const key = await importKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes as unknown as ArrayBuffer,
    new TextEncoder().encode(body),
  );
  if (!ok) return { valid: false, reason: "bad_signature" };

  const bodyBytes = fromBase64Url(body);
  if (!bodyBytes) return { valid: false, reason: "malformed" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return { valid: false, reason: "malformed" };
  }

  const payload = parsed as Partial<ChatAccessTokenPayload>;
  if (
    typeof payload.planId !== "string" ||
    typeof payload.clientId !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { valid: false, reason: "malformed" };
  }
  if (payload.purpose !== TOKEN_PURPOSE) return { valid: false, reason: "purpose_mismatch" };
  if (payload.exp <= nowSec) return { valid: false, reason: "expired" };

  return {
    valid: true,
    payload: {
      purpose: TOKEN_PURPOSE,
      planId: payload.planId,
      clientId: payload.clientId,
      exp: payload.exp,
    },
  };
}
