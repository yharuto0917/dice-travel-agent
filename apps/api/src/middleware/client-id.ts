import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

/** 匿名クライアントIDを保持する Cookie 名。 */
export const CLIENT_ID_COOKIE = "cid";

/** Cookie の有効期間（1年）。レート制限は日次のため、識別子自体は長期保持する。 */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * 署名付き Cookie による匿名クライアント識別ミドルウェア。
 *
 * - 既存の正当な Cookie があれば `clientId` として解決する。
 * - 無い／署名不一致（改竄）の場合は新しい UUID を発行し、
 *   HttpOnly・Secure・SameSite=Lax の署名付き Cookie として再発行する。
 *
 * これがレート制限（#17）のカウント単位になる。認証は行わない。
 */
export const clientId = createMiddleware<AppEnv>(async (c, next) => {
  const secret = c.env.COOKIE_SECRET;

  // getSignedCookie は string（正当）/ false（署名不一致）/ undefined（未設定）を返す。
  const existing = await getSignedCookie(c, secret, CLIENT_ID_COOKIE);

  let id: string;
  if (typeof existing === "string" && existing.length > 0) {
    id = existing;
  } else {
    id = crypto.randomUUID();
    await setSignedCookie(c, CLIENT_ID_COOKIE, id, secret, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }

  c.set("clientId", id);
  await next();
});
