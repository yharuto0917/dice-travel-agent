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
});
export type AgentState = z.infer<typeof AgentStateSchema>;
