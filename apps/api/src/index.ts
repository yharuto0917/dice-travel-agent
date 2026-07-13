import type { RateLimitsResponse } from "@repo/shared";
import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDb } from "./db/client";
import type { AppEnv, Bindings } from "./env";
import { peekRateLimit } from "./lib/rate-limit";
import { clientId } from "./middleware/client-id";
import plansRoute from "./routes/plans";

// Durable Object クラスを Worker のエントリから re-export する（wrangler が DO として登録）。
export { TravelPlanningAgent } from "./agents/travel-planning-agent";

/** 開発時に許可するフロントのオリジン（本番は WEB_ORIGIN で指定）。 */
const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8787",
  "http://localhost:8788",
  "http://localhost:8789",
];

const app = new Hono<AppEnv>({ strict: false });

// 資格情報付き fetch（credentials: "include"）で Cookie を送受信できるよう
// 許可オリジンを明示し、credentials を有効化する（ワイルドカードは使えない）。
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      if (c.env.WEB_ORIGIN && origin === c.env.WEB_ORIGIN) return origin;
      if (DEV_ORIGINS.includes(origin)) return origin;
      return undefined;
    },
    credentials: true,
  }),
);

// 全ルートで匿名クライアントIDを解決（無ければ発行）する。
app.use("*", clientId);

app.route("/plans", plansRoute);

app.get("/", (c) => c.text("Dice Travel Agent API is running!"));
app.get("/health", (c) => c.json({ ok: true }));

/** R2 からアセットを提供するエンドポイント（#18） */
app.get("/assets/:folder/:filename", async (c) => {
  const folder = c.req.param("folder");
  const filename = c.req.param("filename");
  const key = `${folder}/${filename}`;
  const object = await c.env.BUCKET.get(key);
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);

  return new Response(object.body, { headers });
});

/** 現在のクライアント識別子を返す（Cookie 発行の確認・フロント初期化用）。 */
app.get("/me", (c) => c.json({ clientId: c.get("clientId") }));

/**
 * 当日（JST）のスコープ別レート制限の残回数・リセット時刻を返す（#17）。
 * フロントの残回数表示・超過案内に使う。カウンタは消費しない。
 */
app.get("/rate-limits", async (c) => {
  const db = getDb(c.env);
  const id = c.get("clientId");
  const now = new Date();
  const [plan, chat] = await Promise.all([
    peekRateLimit(db, id, "plan", now),
    peekRateLimit(db, id, "chat", now),
  ]);
  return c.json({ plan, chat } satisfies RateLimitsResponse);
});

export type AppType = typeof app;

/**
 * Worker エントリ。`/agents/*` は Agents SDK のルーティングへ、それ以外は
 * 既存の Hono アプリ（CORS・clientId ミドルウェア込み）へフォールバックする。
 *
 * クライアントは `/agents/travel-planning-agent/{planId}` に WebSocket 接続し、
 * `setState` でブロードキャストされる AgentState を購読する。
 * 認証/レート制限・本番CORS厳格化は #17 / #23 で対応する。
 */
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    return (await routeAgentRequest(request, env, { cors: true })) ?? app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Bindings>;
