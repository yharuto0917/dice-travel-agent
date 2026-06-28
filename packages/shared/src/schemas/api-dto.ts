import { z } from "zod";
import { GeoPointSchema, ImageRefSchema, MoneySchema } from "./common";

/** 外部APIの出所（正規化後も保持） */
export const ApiSourceSchema = z.enum([
  "foursquare",
  "google",
  "openmeteo",
  "jma",
  "gsi",
  "rakuten",
  "hotpepper",
  "odpt",
  "unsplash",
  "pexels",
  "gemini",
]);
export type ApiSource = z.infer<typeof ApiSourceSchema>;

/** 観光スポット/POI（Foursquare/Google Places を正規化） */
export const PoiSchema = z.object({
  id: z.string(),
  name: z.string(),
  point: GeoPointSchema,
  category: z.string().optional(),
  address: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  priceLevel: z.number().int().min(0).max(4).optional(),
  url: z.url().optional(),
  image: ImageRefSchema.optional(),
  source: ApiSourceSchema,
});
export type Poi = z.infer<typeof PoiSchema>;

/** 1日分の天気（Open-Meteo/気象庁 を正規化） */
export const WeatherDailySchema = z.object({
  date: z.string(),
  tempMaxC: z.number().optional(),
  tempMinC: z.number().optional(),
  condition: z.string().optional(),
  precipitationProbPct: z.number().min(0).max(100).optional(),
  source: ApiSourceSchema,
});
export type WeatherDaily = z.infer<typeof WeatherDailySchema>;

/** 宿泊施設（楽天トラベル を正規化） */
export const LodgingSchema = z.object({
  id: z.string(),
  name: z.string(),
  point: GeoPointSchema.optional(),
  pricePerNight: MoneySchema.optional(),
  rating: z.number().min(0).max(5).optional(),
  url: z.url().optional(),
  image: ImageRefSchema.optional(),
  source: ApiSourceSchema,
});
export type Lodging = z.infer<typeof LodgingSchema>;

/** 飲食店（ホットペッパー を正規化） */
export const RestaurantSchema = z.object({
  id: z.string(),
  name: z.string(),
  genre: z.string().optional(),
  point: GeoPointSchema.optional(),
  budget: MoneySchema.optional(),
  url: z.url().optional(),
  image: ImageRefSchema.optional(),
  source: ApiSourceSchema,
});
export type Restaurant = z.infer<typeof RestaurantSchema>;

/** 画像検索結果（Unsplash/Pexels を正規化。帰属表示必須） */
export const ImageResultSchema = z.object({
  url: z.url(),
  thumbUrl: z.url().optional(),
  alt: z.string().optional(),
  author: z.string().optional(),
  authorUrl: z.url().optional(),
  source: ApiSourceSchema,
});
export type ImageResult = z.infer<typeof ImageResultSchema>;

/** 移動区間（距離概算/ODPT/Google Directions を正規化） */
export const TransportLegSchema = z.object({
  mode: z.enum(["walk", "transit", "car", "bicycle", "other"]),
  fromName: z.string(),
  toName: z.string(),
  durationMin: z.number().int().min(0).optional(),
  distanceKm: z.number().min(0).optional(),
  cost: MoneySchema.optional(),
  source: ApiSourceSchema.optional(),
});
export type TransportLeg = z.infer<typeof TransportLegSchema>;

import { TripConditionsSchema } from "./conditions";
import { TravelPlanDraftSchema } from "./plan";

/** 計画作成リクエスト */
export const CreatePlanRequestSchema = z.object({
  destinationPrefCode: z.string(),
  destinationPref: z.string(),
  // 保存スキーマ（TripConditionsSchema）の origin は後方互換のため `.default("")` だが、
  // 新規作成の入力境界ではここで必須を強制する（初日の移動の起点に使うため）。
  conditions: TripConditionsSchema.extend({
    origin: z.string().trim().min(1, "出発地を入力してください"),
  }),
});
export type CreatePlanRequest = z.infer<typeof CreatePlanRequestSchema>;

/** 計画取得レスポンス（GET /plans/:id, #16）。`plan` は完成前は下書き。 */
export const GetPlanResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["draft", "completed"]),
  title: z.string().nullable(),
  destinationPref: z.string().nullable(),
  conditions: TripConditionsSchema.nullable(),
  plan: TravelPlanDraftSchema.nullable(),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GetPlanResponse = z.infer<typeof GetPlanResponseSchema>;

/** バージョン復元リクエスト（POST /plans/:id/restore, #16）。 */
export const RestorePlanRequestSchema = z.object({
  version: z.number().int().min(1),
});
export type RestorePlanRequest = z.infer<typeof RestorePlanRequestSchema>;

/** レート制限のスコープ（計画生成 / 常駐チャット, #17）。 */
export const RateScopeSchema = z.enum(["plan", "chat"]);
export type RateScope = z.infer<typeof RateScopeSchema>;

/**
 * 1スコープの当日（JST）レート制限状況（#17）。
 * `remaining` は残回数（0 未満にはならない）、`resetAt` は次にリセットされる
 * JST 00:00 の時刻（ISO 文字列, UTC）。超過時 UX の「次回可能時刻」に使う。
 */
export const RateLimitStatusSchema = z.object({
  scope: RateScopeSchema,
  limit: z.number().int().min(0),
  used: z.number().int().min(0),
  remaining: z.number().int().min(0),
  resetAt: z.string(),
});
export type RateLimitStatus = z.infer<typeof RateLimitStatusSchema>;

/** 全スコープのレート制限状況（GET /rate-limits, #17）。 */
export const RateLimitsResponseSchema = z.object({
  plan: RateLimitStatusSchema,
  chat: RateLimitStatusSchema,
});
export type RateLimitsResponse = z.infer<typeof RateLimitsResponseSchema>;

/** チャット送信リクエスト（POST /plans/:id/chat, #17/#20）。 */
export const SendChatMessageRequestSchema = z.object({
  content: z.string().trim().min(1, "メッセージを入力してください").max(2000),
});
export type SendChatMessageRequest = z.infer<typeof SendChatMessageRequestSchema>;

/** チャットメッセージ1件（#20）。 */
export const ChatMessageSchema = z.object({
  id: z.string(),
  planId: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
