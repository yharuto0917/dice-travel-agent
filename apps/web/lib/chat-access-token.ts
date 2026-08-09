/**
 * 常駐チャット（#20）の接続許可期限をブラウザ側で保持するユーティリティ。
 *
 * 署名付き access token 本体は API origin の HttpOnly Cookie に置き、JavaScript や
 * WebSocket URL からは触れない。ここで扱うのは「どの planId の接続許可が期限内か」
 * という UI 用マーカーだけで、改竄しても Worker の認可ゲートで弾かれる。
 *
 * 保存先は `sessionStorage`。タブを閉じれば消えるため、共有端末では再度 Turnstile を通す。
 */

/** 保存キーの接頭辞。planId ごとに別のトークンを持つ。 */
const STORAGE_PREFIX = "tabidice.chatAccess.";

/**
 * 期限判定の安全マージン（ミリ秒）。
 * ちょうど期限際のトークンで接続して 401 になるのを避けるため、
 * 実際の失効より少し早く「切れている」と判断する。
 */
const EXPIRY_SKEW_MS = 30 * 1000;

export interface StoredChatAccess {
  expiresAt: string;
}

function storageKey(planId: string): string {
  return `${STORAGE_PREFIX}${planId}`;
}

/** sessionStorage を安全に触る（プライベートモード等で例外になることがある）。 */
function safeSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** 指定 planId の接続許可期限を保存する。 */
export function saveChatAccess(planId: string, access: StoredChatAccess): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(planId), JSON.stringify(access));
  } catch {
    // 容量超過などは致命的でない（次回 Turnstile を通せば取り直せる）。
  }
}

/**
 * 指定 planId の有効な接続許可マーカーを取り出す。
 * 未保存・壊れている・期限切れの場合は null を返し、期限切れなら保存も消す。
 */
export function loadChatAccess(planId: string, now: Date = new Date()): StoredChatAccess | null {
  const storage = safeSessionStorage();
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(planId));
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearChatAccess(planId);
    return null;
  }

  const value = parsed as Partial<StoredChatAccess>;
  if (typeof value.expiresAt !== "string") {
    clearChatAccess(planId);
    return null;
  }

  const expiresAtMs = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs - EXPIRY_SKEW_MS <= now.getTime()) {
    clearChatAccess(planId);
    return null;
  }

  return { expiresAt: value.expiresAt };
}

/** 指定 planId の接続許可マーカーを破棄する。 */
export function clearChatAccess(planId: string): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(planId));
  } catch {
    // 破棄できなくても致命的でない。
  }
}
