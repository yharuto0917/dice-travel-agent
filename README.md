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
