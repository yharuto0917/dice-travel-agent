import { z } from "zod";
import { TravelPlanDraftSchema } from "./plan";

/** AI Agent の進行フェーズ（決まったフローの段階） */
export const AgentPhaseSchema = z.enum([
  "idle",
  "understanding", // 行き先・条件の理解
  "collecting", // 外部APIで情報収集
  "designing", // 日程設計
  "lodging", // 宿
  "food", // 飲食
  "transport", // 移動
  "budget", // 予算
  "imagery", // 画像生成
  "finalizing", // 仕上げ
  "awaiting_user", // Human-in-the-loop の回答待ち
  "done",
  "error",
]);
export type AgentPhase = z.infer<typeof AgentPhaseSchema>;

/** 実行履歴イベントの種別（タイムライン表示の分類） */
export const TimelineEventKindSchema = z.enum([
  "phase", // フェーズ遷移
  "tool", // ツール実行（検索・地図・計算など）
  "subagent", // サブエージェント実行（research/enhancement/factcheck/summarize）
  "thinking", // 思考（Gemini reasoning）
  "hitl", // Human-in-the-loop 質問
  "status", // 汎用ステータス（上記に該当しない進行表示）
]);
export type TimelineEventKind = z.infer<typeof TimelineEventKindSchema>;

/** 実行履歴イベントの状態。単発イベントは "done"、長時間処理は start→done で対にする。 */
export const TimelineEventStatusSchema = z.enum(["start", "done", "error"]);
export type TimelineEventStatus = z.infer<typeof TimelineEventStatusSchema>;

/**
 * 実行履歴の1イベント（#47 可観測性）。
 * orchestrator のツール/サブエージェント/思考の進行を時系列で蓄積し、フロントで
 * 「何をしたか」を振り返れるようにする。`start` で開始イベントを積み、対応する処理が
 * 終わったら同じ groupId の `done`/`error` を積む（並列実行の判別に groupId を使う）。
 */
export const TimelineEventSchema = z.object({
  id: z.string(),
  kind: TimelineEventKindSchema,
  /** 表示用ラベル（日本語。例: "飲食店を調査しています"） */
  label: z.string(),
  /** 開始/完了/失敗。単発イベントは "done"。 */
  status: TimelineEventStatusSchema.default("done"),
  /** 開始と完了を対応づけるキー（並列実行時の判別用。任意）。 */
  groupId: z.string().nullable().default(null),
  /** 補足テキスト（思考要約・結果サマリなど。任意）。 */
  detail: z.string().nullable().default(null),
  /** 対象の日番号（per-day ループ中のイベントのみ。任意）。 */
  dayNumber: z.number().int().min(1).nullable().default(null),
  /** 発生時刻(ISO)。 */
  at: z.string(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

/** Human-in-the-loop の質問1件 */
export const HitlQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  /** 選択肢（自由記述のみの場合は省略） */
  options: z.array(z.string()).optional(),
  answer: z.string().nullable().default(null),
  status: z.enum(["pending", "answered", "skipped"]).default("pending"),
});
export type HitlQuestion = z.infer<typeof HitlQuestionSchema>;

/** Agent の同期状態（Durable Object の state、クライアントへ同期） */
export const AgentStateSchema = z.object({
  phase: AgentPhaseSchema.default("idle"),
  /** 段階的に充填される計画下書き */
  plan: TravelPlanDraftSchema.default({}),
  /** HITL 質問キュー */
  questions: z.array(HitlQuestionSchema).default([]),
  /** 充填済みセクション名（"days" 等） */
  filledSections: z.array(z.string()).default([]),
  /** 進捗 0〜1 */
  progress: z.number().min(0).max(1).default(0),
  error: z.string().nullable().default(null),
  /** ストリーミング中の実行状況（例: "観光スポットを検索しています"）。アイドル時は null。 */
  activity: z.string().nullable().default(null),
  /** 思考中の要約テキスト（Gemini の reasoning）。直近の末尾を表示用に保持。非思考時は null。 */
  thought: z.string().nullable().default(null),
  /**
   * 実行履歴タイムライン（#47）。時系列で末尾に追記し、生成完了後も振り返れる。
   * DO state はクライアントへ全同期されるため、Agent 側で上限件数に丸めて肥大を防ぐ。
   */
  timeline: z.array(TimelineEventSchema).default([]),
  /**
   * HITL/タイムアウトで一時停止した際に再開すべき runStep の index。
   * `awaiting_user` 中のみ非 null。回答・スキップ・タイムアウトで同 index を再 schedule する。
   */
  resumeIndex: z.number().int().nullable().default(null),
  /** `awaiting_user` に入った時刻(ISO)。タイムアウト判定の起点（内部用途）。 */
  awaitingSince: z.string().nullable().default(null),
});
export type AgentState = z.infer<typeof AgentStateSchema>;
