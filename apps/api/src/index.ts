import { CHAT_ACCESS_QUERY_PARAM, type RateLimitsResponse } from "@repo/shared";
import { routeAgentRequest } from "agents";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDb } from "./db/client";
import { plans } from "./db/schema";
import type { AppEnv, Bindings } from "./env";
import { verifyChatAccessToken } from "./lib/chat-access-token";
import { peekRateLimit } from "./lib/rate-limit";
import { clientId } from "./middleware/client-id";
import plansRoute from "./routes/plans";

export { TravelChatAgent } from "./agents/travel-chat-agent";
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

/** 常駐チャット Agent のルーティング接頭辞（`/agents/{kebab-class-name}/{planId}`）。 */
const CHAT_AGENT_PREFIX = "/agents/travel-chat-agent/";

/**
 * 常駐チャット Agent への接続を認可する（#20）。
 *
 * Chat Agent は WebSocket で公開されるため Cookie ミドルウェアを経由しない。
 * 発行済みの chat access token（Turnstile + 所有者確認を通した時だけ発行）を検証し、
 * URL の planId・計画の所有者と突き合わせる。
 *
 * - token が主張する planId と URL の planId が食い違えば拒否（他計画への流用を防ぐ）
 * - token の clientId が計画の所有者でなければ拒否（漏れた token の横展開を防ぐ）
 *
 * 認可を通った場合だけ null を返し、呼び出し側が Agents SDK のルーティングへ進む。
 */
async function authorizeChatAgent(request: Request, env: Bindings): Promise<Response | null> {
  const url = new URL(request.url);
  const planId = decodeURIComponent(
    url.pathname.slice(CHAT_AGENT_PREFIX.length).split("/")[0] ?? "",
  );
  if (!planId) return new Response("plan not found", { status: 404 });

  const result = await verifyChatAccessToken(
    env.CHAT_ACCESS_SECRET,
    url.searchParams.get(CHAT_ACCESS_QUERY_PARAM),
  );
  if (!result.valid) return new Response("chat access denied", { status: 401 });
  if (result.payload.planId !== planId) return new Response("chat access denied", { status: 403 });

  const db = getDb(env);
  const [row] = await db
    .select({ clientId: plans.clientId })
    .from(plans)
    .where(eq(plans.id, planId));
  if (!row) return new Response("plan not found", { status: 404 });
  if (row.clientId !== result.payload.clientId) {
    return new Response("chat access denied", { status: 403 });
  }

  return null;
}

/**
 * Worker エントリ。`/agents/*` は Agents SDK のルーティングへ、それ以外は
 * 既存の Hono アプリ（CORS・clientId ミドルウェア込み）へフォールバックする。
 *
 * クライアントは `/agents/travel-planning-agent/{planId}` に WebSocket 接続し、
 * `setState` でブロードキャストされる AgentState を購読する。
 * 常駐チャット（`/agents/travel-chat-agent/{planId}`）だけは接続前に
 * chat access token の認可ゲートを通す。計画生成 Agent 側の認可強化は #23 で扱う。
 */
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname.startsWith(CHAT_AGENT_PREFIX)) {
      const denied = await authorizeChatAgent(request, env);
      if (denied) return denied;
    }
    return (await routeAgentRequest(request, env, { cors: true })) ?? app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Bindings>;
