# Dice Travel Agent

[![CI](https://github.com/yharuto0917/dice-travel-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/yharuto0917/dice-travel-agent/actions/workflows/ci.yml)

## プロジェクト構成

```text
.
├── apps/
│   ├── api/          # APIサーバー (Cloudflare Workers)
│   └── web/          # フロントエンド (Next.js)
├── packages/
│   ├── shared/       # フロントエンドとAPIで共有する共通ロジックや型定義
│   └── tsconfig/     # プロジェクト全体で共有する TypeScript の設定
├── package.json      # ワークスペース全体の依存関係やスクリプト定義
└── pnpm-workspace.yaml # pnpm workspace の定義ファイル
```

## ボット対策（Cloudflare Turnstile, #49）

高コストなプラン生成エンドポイントは、Cookie 単位のレートリミット（#17）に加えて
**Cloudflare Turnstile** による人間性検証で二段に保護する（人間性検証 → 回数制限）。
フロントでウィジェットのトークンを取得し、API（`POST /plans`）が `siteverify` を通過した
リクエストのみエージェントを起動する。

### 必要なキー（実値はコミット禁止）

Cloudflare ダッシュボードで Turnstile サイトを作成し、site key（公開）と secret key（秘匿）を発行する。

| キー | 用途 | 設定先 |
| --- | --- | --- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | フロントのウィジェット表示（公開） | `apps/web` のビルド時環境変数 |
| `TURNSTILE_SECRET_KEY` | API の `siteverify`（秘匿） | `apps/api/.dev.vars`（ローカル）/ `wrangler secret put`（本番） |

### ローカル開発時の挙動（通常フローを阻害しない）

- **フロント**: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 未設定時は Cloudflare 公式のテストサイトキー
  （`1x00000000000000000000AA`・常に成功）を既定で使うため、設定なしでもウィジェットが通る。
- **API**: `TURNSTILE_SECRET_KEY` 未設定時は検証をバイパスする（ローカル開発専用）。
  本番では必ず secret を設定すること（未設定運用は禁止）。
- siteverify を含めてローカル検証したい場合は、API の `.dev.vars` に Cloudflare のテスト secret
  （`1x0000000000000000000000000000000AA`・常に成功 / `2x...AA`・常に失敗）を設定する。
- スクリプト読込失敗時はウィジェットがエラーを表示し、トークン未取得のため生成ボタンは無効のまま
  （fail-closed）。
