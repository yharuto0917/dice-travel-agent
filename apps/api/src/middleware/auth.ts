import { Auth, WorkersKVStoreSingle } from "firebase-auth-cloudflare-workers";
import { createMiddleware } from "hono/factory";
import type { Bindings } from "../env";

/** 認証済みユーザー（検証済み IDトークンから解決） */
export type AuthUser = {
  uid: string;
  email: string | null;
};

/** Hono の型（Bindings ＋ 認証ユーザーの Variables） */
export type AppEnv = {
  Bindings: Bindings;
  Variables: { user: AuthUser };
};

const JWK_CACHE_KEY = "firebase-public-jwk";

/**
 * Firebase ID トークンを検証する Hono ミドルウェア。
 * `Authorization: Bearer <idToken>` を検証し、`c.get("user")` で uid/email を参照可能にする。
 * Google の公開鍵は KV にキャッシュする（Workers 互換の検証ライブラリを使用）。
 */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    return c.json({ error: "unauthorized" }, 401);
  }

  try {
    const auth = Auth.getOrInitialize(
      c.env.FIREBASE_PROJECT_ID,
      WorkersKVStoreSingle.getOrInitialize(JWK_CACHE_KEY, c.env.KV),
    );
    const decoded = await auth.verifyIdToken(token);
    c.set("user", { uid: decoded.uid, email: decoded.email ?? null });
  } catch {
    return c.json({ error: "invalid_token" }, 401);
  }

  await next();
});
