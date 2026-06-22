import { z } from "zod";
import { AttributionSchema, GeoPointSchema, ImageRefSchema, MoneySchema } from "./common";
import { TripConditionsSchema } from "./conditions";
import { DestinationCandidateSchema } from "./destination";

/** 旅程アイテムの種別 */
export const PlanItemTypeSchema = z.enum([
  "spot", // 観光スポット
  "meal", // 飲食
  "lodging", // 宿泊
  "transport", // 移動
  "activity", // 体験・アクティビティ
  "free", // 自由時間
]);
export type PlanItemType = z.infer<typeof PlanItemTypeSchema>;

/** 旅程の1アイテム */
export const PlanItemSchema = z.object({
  id: z.string(),
  type: PlanItemTypeSchema,
  title: z.string(),
  description: z.string().optional(),
  /** 開始時刻 "HH:mm" */
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  durationMin: z.number().int().min(0).optional(),
  location: z
    .object({
      name: z.string(),
      address: z.string().optional(),
      point: GeoPointSchema.optional(),
    })
    .optional(),
  cost: MoneySchema.optional(),
  image: ImageRefSchema.optional(),
  attribution: AttributionSchema.optional(),
  sourceUrl: z.url().optional(),
});
export type PlanItem = z.infer<typeof PlanItemSchema>;

/** 1日分の旅程 */
export const PlanDaySchema = z.object({
  dayNumber: z.number().int().min(1),
  /** ISO日付 "YYYY-MM-DD"（任意） */
  date: z.string().optional(),
  title: z.string().optional(),
  items: z.array(PlanItemSchema).default([]),
});
export type PlanDay = z.infer<typeof PlanDaySchema>;

/** 予算内訳（概算） */
export const BudgetBreakdownSchema = z.object({
  transport: MoneySchema.optional(),
  lodging: MoneySchema.optional(),
  food: MoneySchema.optional(),
  activities: MoneySchema.optional(),
  other: MoneySchema.optional(),
  total: MoneySchema.optional(),
});
export type BudgetBreakdown = z.infer<typeof BudgetBreakdownSchema>;

/** 完成した旅行計画書（最終成果物・しおりの元データ） */
export const TravelPlanSchema = z.object({
  id: z.string(),
  status: z.enum(["draft", "completed"]).default("draft"),
  destination: DestinationCandidateSchema,
  conditions: TripConditionsSchema,
  title: z.string(),
  summary: z.string(),
  /** ISO日付 "YYYY-MM-DD"（任意） */
  startDate: z.string().optional(),
  nights: z.number().int().min(0),
  days: z.array(PlanDaySchema),
  budget: BudgetBreakdownSchema.optional(),
  coverImage: ImageRefSchema.optional(),
  images: z.array(ImageRefSchema).default([]),
  /** 生成日時(ISO)・使用モデル等のメタ */
  createdAt: z.string().optional(),
  model: z.string().optional(),
});
export type TravelPlan = z.infer<typeof TravelPlanSchema>;

/**
 * 生成途中の計画（AI Agentが段階的に埋める下書き）。
 * トップレベル項目を任意化し「未充填／充填済み」を表現する。
 */
export const TravelPlanDraftSchema = TravelPlanSchema.partial();
export type TravelPlanDraft = z.infer<typeof TravelPlanDraftSchema>;
