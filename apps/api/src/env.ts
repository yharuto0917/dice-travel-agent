/**
 * Worker のバインディング型（apps/api/wrangler.json と対応）。
 * 型は @cloudflare/workers-types のグローバル宣言を使用する（tsconfig の types に登録済み）。
 * 実リソース作成後は `pnpm typegen`（wrangler types）で worker-configuration.d.ts も生成できる。
 */
export type Bindings = {
  /** D1: 旅行計画・レートリミット等の永続化（スキーマは #4 / #6） */
  DB: D1Database;
  /** KV: 外部APIレスポンスのキャッシュ / レートリミットのカウンタ */
  KV: KVNamespace;
  /** R2: 生成・取得画像やPDFの保存（#18 / #21） */
  BUCKET: R2Bucket;
  /** Workers AI バインディング */
  AI: Ai;
  /** AI Gateway 経由で Gemini を呼ぶためのアカウントID / ゲートウェイ名（#14） */
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_NAME: string;
  /**
   * AI Gateway 認証トークン（Cloudflare API トークン, secret 管理）。
   * 認証必須 Gateway を通すため `cf-aig-authorization: Bearer <token>` として併送する（#14）。
   */
  AI_GATEWAY_TOKEN?: string;
  /** 匿名クライアント識別 Cookie の署名用シークレット（secret 管理, #6） */
  COOKIE_SECRET: string;
  /**
   * Cloudflare Turnstile の secret key（secret 管理, #49）。
   * プラン生成前の人間性検証（siteverify）に使う。未設定時はローカル開発として検証をバイパスする。
   */
  TURNSTILE_SECRET_KEY?: string;
  /** CORS 許可オリジン（フロント本番URL）。未設定時は開発用オリジンのみ許可（#6） */
  WEB_ORIGIN?: string;

  /** 外部APIキー */
  RAKUTEN_APP_ID?: string;
  RAKUTEN_ACCESS_KEY?: string;
  HOTTOPEPPER_KEY?: string;
  FOURSQUARE_KEY?: string;
  UNSPLASH_ACCESS_KEY?: string;
  UNSPLASH_SECRET_KEY?: string;
  GOOGLE_MAPS_API_KEY?: string;
  PEXELS_API_KEY?: string;
  ODPT_API_KEY?: string;
  /** Google AI Studio APIキー（パススルー方式の Gemini モデル認証, secret 管理, #14） */
  GEMINI_API_KEY?: string;
};

/**
 * Hono の Context Variables。ミドルウェアで解決した値を `c.get()` で参照する。
 */
export type Variables = {
  /** 署名付き Cookie で識別する匿名クライアントID（#6） */
  clientId: string;
};

/** Hono アプリ共通の型パラメータ。 */
export type AppEnv = { Bindings: Bindings; Variables: Variables };
