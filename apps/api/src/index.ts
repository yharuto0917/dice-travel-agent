import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./env";
import { clientId } from "./middleware/client-id";
import plansRoute from "./routes/plans";

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

/** 現在のクライアント識別子を返す（Cookie 発行の確認・フロント初期化用）。 */
app.get("/me", (c) => c.json({ clientId: c.get("clientId") }));

export type AppType = typeof app;
export default app;
