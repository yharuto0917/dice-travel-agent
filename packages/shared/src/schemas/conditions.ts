import { z } from "zod";

/** 旅行条件入力（テーマ・予算感・カスタマイズ） */
export const TripConditionsSchema = z.object({
  /**
   * 出発地（都道府県・市区町村・駅名など）。初日の移動の起点に使う。
   * 入力境界（CreatePlanRequestSchema）では必須だが、ここでは `.default("")` に留める。
   * TravelPlanSchema にも本スキーマが埋め込まれており、origin を持たない既存の保存データ
   * （本フィールド追加前のドラフト）を finalize 時の検証（TravelPlanSchema.safeParse）で
   * 落とさないため（後方互換）。
   */
  origin: z.string().default(""),
  /** テーマ（温泉/グルメ/自然/歴史 など。自由記述含む） */
  themes: z.array(z.string()).default([]),
  /** 1人あたりの予算範囲（円） [min, max] */
  budgetRange: z.tuple([z.number(), z.number()]).default([0, 100000]),
  /** 泊数（0=日帰り） */
  nights: z.number().int().min(0).max(14).default(1),
  partySize: z.number().int().min(1).max(20).default(1),
  /** 移動手段の希望（公共交通/レンタカー 等） */
  transportPreferences: z.array(z.string()).default([]),
  /** 自由記述のカスタマイズ要望 */
  customRequests: z.string().max(2000).optional(),
});
export type TripConditions = z.infer<typeof TripConditionsSchema>;
