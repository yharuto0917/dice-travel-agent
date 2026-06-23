import type { TravelPlanDraft, TripConditions } from "@repo/shared";
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => text(name).notNull().default(sql`(CURRENT_TIMESTAMP)`);

// 認証は廃止。ユーザーは署名付き Cookie の匿名クライアントID（client_id）で識別する（#6）。
// 旧 users テーブルおよび user_id 外部キーは撤廃した。

/**
 * 旅行計画。計画本体は共有スキーマ（TravelPlanDraft/TravelPlan）に整合する
 * JSON カラムを単一の真実として保持し、一覧表示用に一部を非正規化する。
 */
export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(), // 署名付き Cookie の匿名クライアントID
    status: text("status", { enum: ["draft", "completed"] })
      .notNull()
      .default("draft"),
    title: text("title"),
    destinationPrefCode: text("destination_pref_code"),
    destinationPref: text("destination_pref"),
    conditions: text("conditions", { mode: "json" }).$type<TripConditions>(),
    plan: text("plan", { mode: "json" }).$type<TravelPlanDraft>(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [index("plans_client_id_idx").on(t.clientId)],
);

/**
 * レートリミット。クライアント × スコープ × 日(JST) でカウントする（#17）。
 * scope: "plan"=計画生成（2回/日）, "chat"=常駐チャット（20回/日）。
 */
export const rateLimits = sqliteTable(
  "rate_limits",
  {
    clientId: text("client_id").notNull(), // 署名付き Cookie の匿名クライアントID
    scope: text("scope", { enum: ["plan", "chat"] }).notNull(),
    day: text("day").notNull(), // "YYYY-MM-DD"（JST基準）
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.scope, t.day] })],
);

/** 常駐チャットのメッセージ履歴（#20） */
export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("chat_messages_plan_id_idx").on(t.planId)],
);

/** 生成・取得画像のメタ（R2キー・出典・帰属）（#18） */
export const images = sqliteTable(
  "images",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id").references(() => plans.id),
    r2Key: text("r2_key"),
    url: text("url"),
    source: text("source"),
    attributionAuthor: text("attribution_author"),
    attributionUrl: text("attribution_url"),
    prompt: text("prompt"),
    generated: integer("generated", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("images_plan_id_idx").on(t.planId)],
);

export type PlanRow = typeof plans.$inferSelect;
export type RateLimitRow = typeof rateLimits.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type ImageRow = typeof images.$inferSelect;
