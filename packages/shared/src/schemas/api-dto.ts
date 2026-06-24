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

/** 計画作成リクエスト */
export const CreatePlanRequestSchema = z.object({
  destinationPrefCode: z.string(),
  destinationPref: z.string(),
  conditions: TripConditionsSchema,
});
export type CreatePlanRequest = z.infer<typeof CreatePlanRequestSchema>;
