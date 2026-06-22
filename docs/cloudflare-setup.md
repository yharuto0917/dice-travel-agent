# Cloudflare セットアップ手順

このドキュメントは、`apps/api`（Hono on Workers）が使う Cloudflare リソースの作成と、`wrangler.json` への反映手順をまとめたものです。バインディングの宣言は済んでいるため、**実リソースを作成して ID を差し替える**だけで動作します。

- Account ID: `86f364979b0a3494e007b930762245cb`
- 対象設定ファイル: `apps/api/wrangler.json`
- コマンドは `apps/api` ディレクトリで実行してください（例: `cd apps/api && pnpm exec wrangler ...`）。
- このセッションで実行する場合は、プロンプトに `! pnpm exec wrangler ...` と入力すると出力を取り込めます。

## 1. R2 を有効化（初回のみ）

R2 はアカウントで未有効化のため、まず [Cloudflare ダッシュボード](https://dash.cloudflare.com/) → **R2** から有効化してください（規約同意が必要）。

## 2. リソースを作成して ID を反映

### D1（データベース）

```bash
pnpm exec wrangler d1 create dice-travel-agent-db
```

出力された `database_id` を `wrangler.json` の `d1_databases[0].database_id`（現在 `00000000-0000-0000-0000-000000000000`）に貼り付けます。

### KV（キャッシュ / レートリミット）

```bash
pnpm exec wrangler kv namespace create dice-travel-agent-kv
```

出力された `id` を `wrangler.json` の `kv_namespaces[0].id`（現在 `0000...0000`）に貼り付けます。

### R2（画像 / PDF 保存）

```bash
pnpm exec wrangler r2 bucket create dice-travel-agent-assets
```

バケット名はすでに `wrangler.json` に記載済み（`r2_buckets[0].bucket_name`）のため、作成のみで OK です。

### AI Gateway

`wrangler` に作成コマンドが無いため、いずれかで作成します。

- ダッシュボード: **AI** → **AI Gateway** → Create gateway、Gateway 名を `dice-travel-agent` にする。
- もしくは API:

```bash
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/86f364979b0a3494e007b930762245cb/ai-gateway/gateways" \
  -H "Authorization: Bearer <CLOUDFLARE_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"id":"dice-travel-agent","cache_ttl":0,"collect_logs":true}'
```

Gateway 名は `wrangler.json` の `vars.AI_GATEWAY_NAME` と一致させてください（現在 `dice-travel-agent`）。Gemini は AI Gateway 経由で呼び出します（#14）。

## 3. 型生成

ID 反映後、バインディングの型を生成します（リポジトリルートで）。

```bash
pnpm typegen
```

- `apps/api/worker-configuration.d.ts`（gitignore 対象）
- `apps/web/cloudflare-env.d.ts`（gitignore 対象）

が生成されます。コード側のバインディング型は `apps/api/src/env.ts`（`Bindings`）でも定義しています。

## 4. シークレット（API キー）

値はコミットせず、ローカルは `.dev.vars`（gitignore 済み）、本番は `wrangler secret put` で設定します。

| 変数名 | 用途 | 必須/任意 |
|---|---|---|
| `GEMINI_API_KEY` | Gemini 3.5 Flash / 3.1 Flash Image | 必須 |
| `RAKUTEN_APP_ID` | 楽天トラベル 施設検索/空室検索API | 必須 |
| `HOTPEPPER_KEY` | ホットペッパー グルメサーチAPI | 必須 |
| `FOURSQUARE_KEY` | Foursquare Places（観光/POI） | 必須 |
| `UNSPLASH_KEY` | Unsplash（画像） | 必須 |
| `PEXELS_KEY` | Pexels（画像） | 必須 |
| `GOOGLE_MAPS_API_KEY` | Google Places/Directions/Geocoding（ハイブリッドの任意オプション） | 任意 |

ローカル例（`apps/api/.dev.vars` を新規作成・コミットしない）:

```
GEMINI_API_KEY=...
RAKUTEN_APP_ID=...
HOTPEPPER_KEY=...
FOURSQUARE_KEY=...
UNSPLASH_KEY=...
PEXELS_KEY=...
# GOOGLE_MAPS_API_KEY=...
```

本番:

```bash
pnpm exec wrangler secret put GEMINI_API_KEY
# 以降、必要な変数を順に put
```

## 5. 動作確認

```bash
# ローカル（ローカル擬似 D1/KV/R2 を使用）
pnpm exec wrangler dev

# 設定の静的検証（デプロイはしない）
pnpm exec wrangler deploy --dry-run --outdir dist
```

> Firebase Auth 用のシークレット（#6）や D1 スキーマのマイグレーション（#4）は、それぞれの Issue で追加します。
