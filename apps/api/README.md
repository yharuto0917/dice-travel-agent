# @repo/api — APIサーバー（Hono / Cloudflare Workers）

旅行計画の生成・永続化や外部API統合を担う Workers アプリ。認証は行わず、
**署名付き Cookie による匿名クライアント識別**（#6）を土台に、レート制限（#17）を行う。

## クライアント識別（Cookie）

- 初回アクセス時に匿名クライアントID（UUID）を発行し、`COOKIE_SECRET` で署名した
  Cookie（`cid`）を `HttpOnly` / `Secure` / `SameSite=Lax` で保存する。
- 以降のリクエストでは Cookie を検証し、`c.get("clientId")` で参照できる。
  署名不一致（改竄）や未設定の場合は新しいIDを発行して再設定する。
- 実装: `src/middleware/client-id.ts`。全ルートに適用（`src/index.ts`）。
- フロントは `credentials: "include"` で送受信する（`apps/web/lib/api.ts`）。

> ⚠️ **デプロイ制約（SameSite=Lax）**: `SameSite=Lax` の Cookie は **同一サイト**
> （登録可能ドメイン = eTLD+1 が一致）の fetch でしか送出されない（ポート違いは同一サイト扱い）。
> 識別を成立させるため、**フロントと API は共有親ドメイン配下にデプロイする**こと
> （例: `app.example.com` と `api.example.com`）。
> `*.pages.dev` と `*.workers.dev` のように **別サイト**へ分けると、ブラウザの fetch で
> Cookie が送られず毎回新規クライアント扱いになり、識別・レート制限が機能しない。
> どうしても別サイト構成が必要な場合は `SameSite=None`（+ `Secure`、CSRF 対策を別途）へ
> 切り替える。ローカル開発は `localhost:3000` ⇄ `localhost:8787` が同一サイトのため Lax で動く。

### エンドポイント

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/health` | ヘルスチェック |
| GET | `/me` | 現在の匿名クライアントID（Cookie 発行確認用） |

## 環境変数・シークレット

`COOKIE_SECRET` は **secret** として管理する（`.dev.vars` / `.env` はコミットしない）。

- **ローカル開発**: `apps/api/.dev.vars` に `COOKIE_SECRET="<任意のランダム文字列>"` を記述する
  （`.dev.vars` は gitignore 済み）。
- **本番**: `pnpm --filter @repo/api exec wrangler secret put COOKIE_SECRET` で投入する（#23）。

CORS は `WEB_ORIGIN`（本番のフロントURL）を許可する。未設定時は開発用の
`http://localhost:3000` 等のみ許可する。

## 開発

```bash
pnpm --filter @repo/api dev               # wrangler dev (port 8787)
pnpm --filter @repo/api db:generate       # drizzle マイグレーション生成
pnpm --filter @repo/api db:migrate:local  # ローカル D1 へ適用
pnpm --filter @repo/api db:migrate        # 本番 D1 へ適用（--remote）
```

> マイグレーションは `drizzle-kit generate` でファイル生成し、`wrangler d1 migrations apply`
> で適用する。`drizzle-kit push` は使用しない。
