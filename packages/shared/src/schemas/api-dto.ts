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

/**
 * 計画作成レスポンス（POST /plans, #20）。
 *
 * 生成リクエストは Turnstile 検証を通っているため、同じ検証結果からこの計画専用の
 * chat access token を併せて発行する。これによりしおり到達時に同じ人へ再チャレンジを
 * 要求せずに常駐チャットへ接続できる。
 */
export const CreatePlanResponseSchema = z.object({
  id: z.string(),
  chatAccessToken: z.string(),
  /** トークンの有効期限(ISO)。クライアントは期限切れを検知して再取得する。 */
  expiresAt: z.string(),
});
export type CreatePlanResponse = z.infer<typeof CreatePlanResponseSchema>;

/**
 * chat access token を Chat Agent への接続 URL に載せるクエリパラメータ名（#20）。
 * サーバの認可ゲートとクライアントの `useAgent` で必ず同じ名前を使う。
 */
export const CHAT_ACCESS_QUERY_PARAM = "chatToken";

/**
 * chat access token 発行レスポンス（POST /plans/:id/chat-access, #20）。
 * Home の作成履歴や URL 直開きなど、生成フローを経ずに入る場合に使う。
 */
export const CreateChatAccessResponseSchema = z.object({
  chatAccessToken: z.string(),
  expiresAt: z.string(),
});
export type CreateChatAccessResponse = z.infer<typeof CreateChatAccessResponseSchema>;

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

/** チャット履歴の上限（1ページ）。DO SQLite より古い分は D1 アーカイブから読み足す。 */
export const CHAT_HISTORY_DEFAULT_LIMIT = 20;
export const CHAT_HISTORY_MAX_LIMIT = 50;

/**
 * チャット履歴取得のクエリ（GET /plans/:id/chat, #20）。
 * `before` は前ページの `nextCursor` をそのまま渡す opaque cursor。
 */
export const ChatHistoryQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHAT_HISTORY_MAX_LIMIT)
    .default(CHAT_HISTORY_DEFAULT_LIMIT),
  before: z.string().optional(),
});
export type ChatHistoryQuery = z.infer<typeof ChatHistoryQuerySchema>;

/**
 * チャット履歴レスポンス（#20）。`messages` は表示順（古い順）で返す。
 * `nextCursor` が null ならそれ以上古い履歴は無い。
 */
export const ChatHistoryResponseSchema = z.object({
  messages: z.array(ChatMessageSchema),
  nextCursor: z.string().nullable(),
});
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>;

/**
 * チャットのストリームに載せる transient data（#20）。
 *
 * `useAgentChat` の `onData` で受け取る。メッセージ本文として永続化したくない
 * 「実行中の状況」「提案が state に載った合図」「レート制限」をここで運ぶ。
 * `type` は AI SDK の UI message stream の実際の形（`data-<name>`）に合わせる。
 */
export const ChatDataPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("data-activity"), data: z.object({ label: z.string() }) }),
  z.object({ type: z.literal("data-proposal"), data: z.object({ editId: z.string() }) }),
  z.object({ type: z.literal("data-rate-limit"), data: RateLimitStatusSchema }),
  /**
   * 修正案づくりの思考過程。`text` はその時点までの**全文**（差分ではない）。
   *
   * 質問応答の思考は assistant メッセージの reasoning パートとして流れるが、修正案づくりは
   * メッセージを組み立てずに進むため、思考を載せる先が無い。ここで transient data として運ぶ。
   * 差分ではなく全文にするのは、順序の入れ替わりや取りこぼしで思考が崩れないようにするため。
   */
  z.object({ type: z.literal("data-reasoning"), data: z.object({ text: z.string() }) }),
]);
export type ChatDataPart = z.infer<typeof ChatDataPartSchema>;
