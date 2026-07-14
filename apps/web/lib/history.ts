/**
 * 作成した旅（しおり）の履歴を Cookie に保存・取得するユーティリティ。
 *
 * しおり本体はサーバー側（D1）が単一の真実で、ここでは「過去に作った旅への再訪導線」
 * のために最小限のメタ情報（planId・タイトル・作成日時）だけを Cookie に持つ。
 * Cookie を使うのは、Home 画面（Server Component）が SSR 時に `next/headers` の
 * `cookies()` で直接読めるため。書き込みは生成完了時にクライアント側で行う。
 */

/** 履歴1件。`id` はしおりの planId、`createdAt` は ISO 文字列。 */
export type TravelHistoryEntry = {
  id: string;
  title: string;
  createdAt: string;
};

/** 履歴を格納する Cookie 名。 */
export const HISTORY_COOKIE_NAME = "travel_history";

/** 保持する最大件数。Cookie の ~4KB 制約に対し、1件 ~100B 程度で十分収まる。 */
export const MAX_HISTORY_ENTRIES = 10;

/** Cookie の有効期間（秒）。約180日。 */
const HISTORY_MAX_AGE_SEC = 60 * 60 * 24 * 180;

/** unknown を安全に TravelHistoryEntry へ絞り込む（壊れた値を弾く）。 */
function isEntry(value: unknown): value is TravelHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.title === "string" && typeof v.createdAt === "string";
}

/**
 * Cookie の生値（`cookies().get()?.value` または `document.cookie` 由来）を
 * 履歴配列へ復元する。復号・パースに失敗しても決してthrowせず `[]` を返す。
 * サーバー・クライアント双方の読み出しで共用する。
 */
export function parseHistory(rawValue: string | undefined): TravelHistoryEntry[] {
  if (!rawValue) return [];
  let decoded = rawValue;
  try {
    decoded = decodeURIComponent(rawValue);
  } catch {
    // 生値がそのまま JSON の場合もあるため、復号失敗時は生値で続行する。
  }
  try {
    const parsed = JSON.parse(decoded);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

/**
 * 履歴を1件追加する（クライアント専用）。同一 `id` は除去して先頭へ、
 * 先頭から `MAX_HISTORY_ENTRIES` 件に切り詰めて `document.cookie` に書き込む。
 * SSR 実行時（`document` 不在）は何もしない。
 */
export function addHistoryEntry(entry: TravelHistoryEntry): void {
  if (typeof document === "undefined") return;

  const current = parseHistory(readRawCookie(HISTORY_COOKIE_NAME));
  const next = [entry, ...current.filter((e) => e.id !== entry.id)].slice(0, MAX_HISTORY_ENTRIES);

  const value = encodeURIComponent(JSON.stringify(next));
  // Cookie Store API は https 必須かつ対応ブラウザが限られるため、広く動く document.cookie を用いる。
  // biome-ignore lint/suspicious/noDocumentCookie: 単純な文字列 Cookie の書き込みで意図的に使用する。
  document.cookie = `${HISTORY_COOKIE_NAME}=${value}; path=/; max-age=${HISTORY_MAX_AGE_SEC}; SameSite=Lax`;
}

/** `document.cookie` から指定名の生値を取り出す（クライアント専用）。 */
function readRawCookie(name: string): string | undefined {
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

/** ISO 文字列を「6/29 0:00」のような JST の短い表記へ整形する。 */
export function formatHistoryDate(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
