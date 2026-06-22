import { z } from "zod";

/** 予算感 */
export const BudgetLevelSchema = z.enum(["low", "mid", "high", "luxury"]);
export type BudgetLevel = z.infer<typeof BudgetLevelSchema>;

/** 旅行条件入力（テーマ・予算感・カスタマイズ） */
export const TripConditionsSchema = z.object({
  /** テーマ（温泉/グルメ/自然/歴史 など。自由記述含む） */
  themes: z.array(z.string()).default([]),
  budgetLevel: BudgetLevelSchema,
  /** 1人あたりの目安予算（円・任意） */
  budgetPerPersonJpy: z.number().min(0).optional(),
  /** 泊数（0=日帰り） */
  nights: z.number().int().min(0).max(14).default(1),
  partySize: z.number().int().min(1).max(20).default(1),
  /** 移動手段の希望（公共交通/レンタカー 等） */
  transportPreferences: z.array(z.string()).default([]),
  /** 自由記述のカスタマイズ要望 */
  customRequests: z.string().max(2000).optional(),
});
export type TripConditions = z.infer<typeof TripConditionsSchema>;
