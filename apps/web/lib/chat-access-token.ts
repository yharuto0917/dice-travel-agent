/**
 * 常駐チャット（#20）の接続トークンをブラウザ側で保持するユーティリティ。
 *
 * 署名検証はサーバのみが行う。ここで扱うのは「どの planId のトークンをいま持っているか」
 * と「期限切れかどうか」だけで、期限判定はサーバへの無駄な接続を減らすための先読みに
 * 過ぎない（改竄しても Hono の認可ゲートで弾かれる）。
 *
 * 保存先は `sessionStorage`。タブを閉じれば消えるため、共有端末でトークンが残らない。
 * Cookie に載せないのは、しおり以外の全リクエストに付いて回る必要がないため。
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
  token: string;
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

/** 指定 planId のトークンを保存する。 */
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
 * 指定 planId の有効なトークンを取り出す。
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
  if (typeof value.token !== "string" || typeof value.expiresAt !== "string") {
    clearChatAccess(planId);
    return null;
  }

  const expiresAtMs = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs - EXPIRY_SKEW_MS <= now.getTime()) {
    clearChatAccess(planId);
    return null;
  }

  return { token: value.token, expiresAt: value.expiresAt };
}

/** 指定 planId のトークンを破棄する。 */
export function clearChatAccess(planId: string): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(planId));
  } catch {
    // 破棄できなくても致命的でない。
  }
}
