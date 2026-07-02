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

/** 旅程の1アイテムの共通プロパティ */
const PlanItemBaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  /** 開始時刻 "HH:mm" */
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  durationMin: z.number().int().min(0).optional(),
  cost: MoneySchema.optional(),
  image: ImageRefSchema.optional(),
  attribution: AttributionSchema.optional(),
  sourceUrl: z.url().optional(),
});

/** 1. 移動 (Transport) */
export const TransportItemSchema = PlanItemBaseSchema.extend({
  type: z.literal("transport"),
  location: z
    .object({
      name: z.string(),
      address: z.string().optional(),
      point: GeoPointSchema.optional(),
    })
    .optional(),
});
export type TransportItem = z.infer<typeof TransportItemSchema>;

/** 2. 宿泊 (Lodging) */
export const LodgingItemSchema = PlanItemBaseSchema.extend({
  type: z.literal("lodging"),
  location: z
    .object({
      name: z.string(),
      address: z.string().optional(),
      point: GeoPointSchema.optional(),
    })
    .optional(),
});
export type LodgingItem = z.infer<typeof LodgingItemSchema>;

/** 3. 滞在場所 (Stay) */
export const StayItemTypeSchema = z.enum(["spot", "meal", "activity", "free"]);
export type StayItemType = z.infer<typeof StayItemTypeSchema>;

export const StayItemSchema = PlanItemBaseSchema.extend({
  type: StayItemTypeSchema,
  location: z
    .object({
      name: z.string(),
      address: z.string().optional(),
      point: GeoPointSchema.optional(),
    })
    .optional(),
});
export type StayItem = z.infer<typeof StayItemSchema>;

/** 旅程の1アイテム */
export const PlanItemSchema = z.union([TransportItemSchema, LodgingItemSchema, StayItemSchema]);
export type PlanItem = z.infer<typeof PlanItemSchema>;

/**
 * LLM 構造化出力（Gemini）用のフラットな item スキーマ。
 *
 * 本来の {@link PlanItemSchema} は `z.union`（→ JSON schema の `anyOf`）。Gemini の
 * 構造化出力は「`anyOf` を要素に持つ配列」の生成が極めて苦手で、スカラー（title 等）だけ
 * 埋めて配列を空（`items: []`）で返してしまう。これが「各日の旅程が出ない」主因だった。
 * 生成時は type を enum、location を任意にまとめた**単一オブジェクト**で出力させることで
 * `anyOf` を回避する。各インスタンスは literal な type により本来の union のいずれかの
 * メンバーを必ず満たすため、生成結果はそのまま {@link PlanDaySchema} / {@link TravelPlanSchema}
 * の検証を通過する（生成専用。保存・検証は引き続き union 側で行う）。
 */
export const PlanItemGenSchema = z.object({
  id: z.string(),
  type: PlanItemTypeSchema,
  title: z.string(),
  description: z.string().optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  durationMin: z.number().int().min(0).optional(),
  cost: MoneySchema.optional(),
  image: ImageRefSchema.optional(),
  location: z
    .object({
      name: z.string(),
      address: z.string().optional(),
      point: GeoPointSchema.optional(),
    })
    .optional(),
});
export type PlanItemGen = z.infer<typeof PlanItemGenSchema>;

/** 1日分の旅程 */
export const PlanDaySchema = z.object({
  dayNumber: z.number().int().min(1),
  /** ISO日付 "YYYY-MM-DD"（任意） */
  date: z.string().optional(),
  title: z.string().optional(),
  items: z.array(PlanItemSchema).default([]),
});
export type PlanDay = z.infer<typeof PlanDaySchema>;

/**
 * LLM 構造化出力（Gemini）用の PlanDay。items を anyOf を避けたフラット item の配列にし、
 * 空生成を防ぐため最低1件を要求する。生成結果は {@link PlanDaySchema} の検証を通過する。
 */
export const PlanDayGenSchema = z.object({
  dayNumber: z.number().int().min(1),
  date: z.string().optional(),
  title: z.string().optional(),
  items: z.array(PlanItemGenSchema).min(1),
});
export type PlanDayGen = z.infer<typeof PlanDayGenSchema>;

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

/** 計画バージョン1件（更新前スナップショットの履歴, #16）。 */
export const PlanVersionSchema = z.object({
  id: z.string(),
  planId: z.string(),
  version: z.number().int().min(1),
  plan: TravelPlanDraftSchema,
  label: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type PlanVersion = z.infer<typeof PlanVersionSchema>;

/** バージョン一覧表示用の軽量メタ（plan 本体を含まない）。 */
export const PlanVersionMetaSchema = PlanVersionSchema.omit({ plan: true });
export type PlanVersionMeta = z.infer<typeof PlanVersionMetaSchema>;

/** 計画アイテムの差分種別 */
export const DiffChangeSchema = z.enum(["added", "removed", "changed", "unchanged"]);
export type DiffChange = z.infer<typeof DiffChangeSchema>;

/** 1アイテムの差分 */
export const ItemDiffSchema = z.object({
  change: DiffChangeSchema,
  title: z.string(),
});
export type ItemDiff = z.infer<typeof ItemDiffSchema>;

/** 1日分の差分 */
export const DayDiffSchema = z.object({
  dayNumber: z.number().int().min(1),
  change: DiffChangeSchema,
  items: z.array(ItemDiffSchema).default([]),
});
export type DayDiff = z.infer<typeof DayDiffSchema>;

/** 2版間の構造化差分（#16 バージョニング） */
export const PlanDiffSchema = z.object({
  titleChanged: z.boolean(),
  summaryChanged: z.boolean(),
  budgetChanged: z.boolean(),
  days: z.array(DayDiffSchema),
});
export type PlanDiff = z.infer<typeof PlanDiffSchema>;
