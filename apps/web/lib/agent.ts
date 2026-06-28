/**
 * TravelPlanningAgent（#13）への接続設定とフェーズ表示のヘルパー。
 *
 * Agent は API Worker（apps/api）側の Durable Object として動作するため、
 * `useAgent` の `host` には API のオリジンを渡す必要がある（web とは別オリジン）。
 */
import type { AgentPhase, PlanItemType, TimelineEventKind } from "@repo/shared";

/** Agent クラス名のケバブ表現（`/agents/travel-planning-agent/{planId}`）。 */
export const TRAVEL_AGENT_NAME = "travel-planning-agent";

/**
 * Agent（= API Worker）へ接続するホスト。`lib/api.ts` の API ベースURLと揃える。
 * partysocket が `http(s)://` を `ws(s)://` へ変換する。
 */
export const AGENT_HOST = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

/** 進行フェーズの日本語ラベル。 */
export const PHASE_LABELS: Record<AgentPhase, string> = {
  idle: "待機中",
  understanding: "行き先と条件を理解しています",
  collecting: "現地の情報を集めています",
  designing: "日程を組み立てています",
  lodging: "宿を選んでいます",
  food: "食事を選んでいます",
  transport: "移動を計画しています",
  budget: "予算を見積もっています",
  imagery: "イメージ画像を用意しています",
  finalizing: "仕上げています",
  awaiting_user: "確認をお願いします",
  done: "プランが完成しました",
  error: "エラーが発生しました",
};

/**
 * 充填済みセクション名（AgentState.filledSections）の日本語ラベル。
 * 値は `apps/api` の PLAN_PIPELINE の `section` と対応する。未知のキーは
 * そのまま表示するフォールバック前提。
 */
export const SECTION_LABELS: Record<string, string> = {
  conditions: "条件",
  research: "情報収集",
  days: "日程",
  lodging: "宿泊",
  food: "食事",
  transport: "移動",
  budget: "予算",
  summary: "仕上げ",
};

/** 実行履歴イベント種別の先頭アイコン（絵文字）。タイムライン表示の視認性向上用（#47）。 */
export const TIMELINE_KIND_ICON: Record<TimelineEventKind, string> = {
  phase: "🧭",
  tool: "🔧",
  subagent: "🧩",
  thinking: "💭",
  hitl: "💬",
  status: "•",
};

/** 旅程アイテム種別の日本語ラベル。 */
export const PLAN_ITEM_LABELS: Record<PlanItemType, string> = {
  spot: "観光",
  meal: "食事",
  lodging: "宿泊",
  transport: "移動",
  activity: "体験",
  free: "フリー",
};
