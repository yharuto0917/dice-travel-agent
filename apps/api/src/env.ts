/**
 * Worker のバインディング型（apps/api/wrangler.json と対応）。
 * 型は @cloudflare/workers-types のグローバル宣言を使用する（tsconfig の types に登録済み）。
 * 実リソース作成後は `pnpm typegen`（wrangler types）で worker-configuration.d.ts も生成できる。
 */
export type Bindings = {
  /** D1: ユーザー・旅行計画・レートリミット等の永続化（スキーマは #4） */
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
};
