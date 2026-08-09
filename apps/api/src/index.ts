import type { RateLimitsResponse } from "@repo/shared";
import { routeAgentRequest } from "agents";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDb } from "./db/client";
import { plans } from "./db/schema";
import type { AppEnv, Bindings } from "./env";
import {
  CHAT_ACCESS_EXPIRES_HEADER,
  chatAgentPlanIdFromPath,
  isChatAgentPath,
  verifyChatAccessRequest,
} from "./lib/chat-access-token";
import { agentCorsHeaders, isAllowedOrigin, withCors } from "./lib/cors";
import { peekRateLimit } from "./lib/rate-limit";
import { clientId } from "./middleware/client-id";
import plansRoute from "./routes/plans";

export { TravelChatAgent } from "./agents/travel-chat-agent";
// Durable Object クラスを Worker のエントリから re-export する（wrangler が DO として登録）。
export { TravelPlanningAgent } from "./agents/travel-planning-agent";

const app = new Hono<AppEnv>({ strict: false });

// 資格情報付き fetch（credentials: "include"）で Cookie を送受信できるよう
// 許可オリジンを明示し、credentials を有効化する（ワイルドカードは使えない）。
app.use(
  "*",
  cors({
    origin: (origin, c) => (isAllowedOrigin(origin, c.env) ? origin : undefined),
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
 * 常駐チャット Agent への接続を認可する（#20）。
 *
 * Chat Agent は WebSocket で公開されるため Cookie ミドルウェアを経由しない。
 * 発行済みの HttpOnly chat access token（Turnstile + 所有者確認を通した時だけ発行）と、
 * 現在の署名付き `cid` Cookie、URL の planId、計画の所有者を突き合わせる。
 *
 * - token が主張する planId と URL の planId が食い違えば拒否（他計画への流用を防ぐ）
 * - token の clientId が現在の署名付き `cid` と違えば拒否（別端末での再利用を防ぐ）
 * - token の clientId が計画の所有者でなければ拒否（他計画への横展開を防ぐ）
 *
 * 認可を通った場合は検証済みの失効時刻を内部ヘッダへ載せた Request を返す。
 */
async function authorizeChatAgent(
  request: Request,
  env: Bindings,
  planId: string,
): Promise<Request | Response> {
  const result = await verifyChatAccessRequest(
    request,
    { chatAccess: env.CHAT_ACCESS_SECRET, cookie: env.COOKIE_SECRET },
    planId,
  );
  if (!result.valid) return new Response("chat access denied", { status: 401 });

  const db = getDb(env);
  const [row] = await db
    .select({ clientId: plans.clientId })
    .from(plans)
    .where(eq(plans.id, planId));
  if (!row) return new Response("plan not found", { status: 404 });
  if (row.clientId !== result.payload.clientId) {
    return new Response("chat access denied", { status: 403 });
  }

  // 外部から同名ヘッダを注入されても、検証済み payload の値で必ず上書きする。
  const headers = new Headers(request.headers);
  headers.set(CHAT_ACCESS_EXPIRES_HEADER, String(result.payload.exp));
  return new Request(request, { headers });
}

/**
 * Worker エントリ。`/agents/*` は Agents SDK のルーティングへ、それ以外は
 * 既存の Hono アプリ（CORS・clientId ミドルウェア込み）へフォールバックする。
 *
 * クライアントは `/agents/travel-planning-agent/{planId}` に WebSocket 接続し、
 * `setState` でブロードキャストされる AgentState を購読する。
 * 常駐チャット（`/agents/travel-chat-agent/{planId}`）だけは接続前に
 * chat access token の認可ゲートを通す。計画生成 Agent 側の認可強化は #23 で扱う。
 *
 * 経路判定は接頭辞の前方一致ではなく、振り分け側（partyserver）と同じセグメント分解で行う
 * （{@link chatAgentPlanIdFromPath} 参照）。前方一致だと `/agents//travel-chat-agent/...` が
 * ゲートを素通りしたまま DO へ到達する。
 *
 * CORS ヘッダは SDK 任せ（`cors: true`）にせず、ここで組み立てたものを渡す。WebSocket は
 * CORS の対象外なので接続は成立するが、Agent の HTTP エンドポイント（`/get-messages`）は
 * 資格情報付き fetch であり、ワイルドカードのままではブラウザに遮断される。
 */
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const corsHeaders = agentCorsHeaders(request, env);

    if (isChatAgentPath(pathname)) {
      // プリフライトは仕様上 Cookie を運ばないため、認可ゲートに掛けると必ず 401 になり、
      // 本リクエストが送られる前にブラウザが遮断する。planId によらず一律で答えるので、
      // ゲートより前に返しても計画の存在有無は漏れない。
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const planId = chatAgentPlanIdFromPath(pathname);
      // planId の形が不正なら DO へ渡さず終わらせる（存在有無も明かさない）。
      if (!planId) return withCors(new Response("plan not found", { status: 404 }), corsHeaders);

      const authorized = await authorizeChatAgent(request, env, planId);
      // 拒否にも CORS ヘッダを付ける。付けないとブラウザが応答そのものを隠すため、
      // クライアントは 401（＝トークンの取り直しが必要）を認識できず fetch 例外だけが残る。
      if (authorized instanceof Response) return withCors(authorized, corsHeaders);
      request = authorized;
    }
    return (
      (await routeAgentRequest(request, env, { cors: corsHeaders })) ?? app.fetch(request, env, ctx)
    );
  },
} satisfies ExportedHandler<Bindings>;
