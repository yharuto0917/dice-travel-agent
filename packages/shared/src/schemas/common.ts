import { z } from "zod";

/** 緯度経度 */
export const GeoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof GeoPointSchema>;

/** データの出典・帰属（Unsplash/Pexels等の帰属表示要件、生成元の明示に使用） */
export const AttributionSchema = z.object({
  /** 例: "unsplash" | "pexels" | "rakuten" | "hotpepper" | "foursquare" | "gemini" 等 */
  source: z.string(),
  author: z.string().optional(),
  url: z.url().optional(),
});
export type Attribution = z.infer<typeof AttributionSchema>;

/** 画像参照（R2配信URL または 外部URL） */
export const ImageRefSchema = z.object({
  id: z.string().optional(),
  url: z.url(),
  thumbUrl: z.url().optional(),
  alt: z.string().optional(),
  attribution: AttributionSchema.optional(),
  /** Nano Banana 2 等で生成した画像か */
  generated: z.boolean().default(false),
});
export type ImageRef = z.infer<typeof ImageRefSchema>;

/** 金額（日本円・基本は概算） */
export const MoneySchema = z.object({
  amount: z.number().min(0),
  currency: z.literal("JPY").default("JPY"),
  approx: z.boolean().default(true),
});
export type Money = z.infer<typeof MoneySchema>;
