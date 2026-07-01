# TabiDice

[![CI](https://github.com/yharuto0917/dice-travel-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/yharuto0917/dice-travel-agent/actions/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=flat-square&logo=cloudflareworkers&logoColor=white)
![Durable Objects](https://img.shields.io/badge/Durable_Objects-F38020?style=flat-square&logo=cloudflare&logoColor=white)
![Gemini API](https://img.shields.io/badge/Gemini_API-8E75C2?style=flat-square&logo=googlegemini&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Biome](https://img.shields.io/badge/Biome-60A5FA?style=flat-square&logo=biome&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)
![Turborepo](https://img.shields.io/badge/Turborepo-EF4444?style=flat-square&logo=turborepo&logoColor=white)
![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_CSS_v4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)

TabiDice は、Cloudflare のエッジコンピューティング環境（Cloudflare Workers & Durable Objects）と Gemini (Vercel AI SDK) を活用した、AI 駆動型の双方向マルチエージェント旅行計画プランナーです。

---

## 🌟 主な機能

### 1. 自律型マルチエージェント旅行計画
ユーザーが提示した旅行の条件（日程、人数、目的地、予算など）に基づき、Supervisor エージェントがスケジュール（Durable Objects）を駆動します。日々の予定作成をループで実行し、各タスクを Capability Pool のサブエージェントやツールに委譲します。

* **Research Agent**: 観光地、ホテル、飲食店、ルートなどの情報を収集。
* **Enhancement Agent**: 提案された計画をブラッシュアップし魅力的に拡張。
* **Factcheck Agent**: 収集した情報の信憑性やルートの実現可能性を検証。
* **Summarize Agent**: 複雑なスケジュールを分かりやすく要約。

### 2. Human-in-the-Loop (HITL) 連携
エージェントが計画中に「どちらのホテルが好みか」「予算を少し超過しても良いか」といった選択肢や不明点に直面した際、エージェントは自動的に処理を一時停止し、ユーザーに質問を投げます。ユーザーからの回答をトリガーにして計画の構築が自動で再開されます。

### 3. インタラクティブな旅行チャット & 編集ループ
計画生成後、ユーザーはチャットインターフェースを通じて旅行エージェントに直接修正の指示を出すことができます。チャット入力の意図（計画の編集 / 質問 / 無関係な内容）を AI が自動判定し、編集ループや QA ループを再駆動して計画 JSON を動的に更新・再検証します。

### 4. 豊富な 3D グラフィックとリッチな UI
ダイス（サイコロ）を振るインタラクティブな演出や、地図データと連携した地理的ビジュアライゼーションを **React Three Fiber (Three.js)** を用いて実装。エッジAIのスピーディな応答と相まって、極めてプレミアムなユーザー体験を提供します。

---

## 🛠️ 技術スタック

### フロントエンド
* **フレームワーク**: Next.js 16.x (App Router, OpenNext により Cloudflare Pages にデプロイ)
* **言語**: TypeScript, React 19
* **スタイリング**: Tailwind CSS v4, Vanilla CSS
* **状態管理**: Zustand, TanStack Query
* **グラフィックス**: React Three Fiber, React Three Drei, Cannon (3D 物理演算), D3-geo
* **UI コンポーネント / アイコン**: Phosphor Icons

### バックエンド (API)
* **フレームワーク**: Hono (Edge-optimized API framework)
* **エージェント基盤**: Cloudflare Agents SDK (Durable Objects による状態・WebSocket 接続の管理)
* **LLM 統合**: Vercel AI SDK (`ai` / `@ai-sdk/google`)
* **モデル**: Gemini 3.5 Flash (Cloudflare AI Gateway 経由によるロギングと監視)
* **データベース**: Cloudflare D1 (SQLite 互換) & Drizzle ORM
* **ストレージ / キャッシュ**: Cloudflare KV (レート制限・サイトキャッシュなど), Cloudflare R2 (アセットバケット)

### 外部 API 連携 (ツール)
* **Google Maps API**: ジオコーディング、目的地間の距離・移動時間算出
* **楽天トラベル API**: 国内ホテル情報の検索
* **ホットペッパー API**: グルメ情報の検索
* **Foursquare API**: 周辺の観光スポットや施設の検索
* **Unsplash API**: スポット紹介用の高品質な画像の取得
* **気象 API**: 現地の天気予報データの取得

---

## 🛡️ セキュリティ & API 悪用対策
コストの高い生成AIや外部検索 API の無駄な呼び出しを防ぐため、二重の保護措置を施しています。
1. **Cloudflare Turnstile**: 人間性検証をフロントエンドで行いボットによる大量アクセスを防ぎます。
2. **レートリミット (Cookie/IP単位)**: 一定時間内のプラン生成・チャット送信回数をデータベース/メモリ上でカウントし制御します。

---

## 📂 プロジェクト構成

```text
.
├── apps/
│   ├── api/          # APIサーバー (Cloudflare Workers & Hono & Durable Objects)
│   └── web/          # フロントエンド (Next.js 16)
├── packages/
│   ├── shared/       # フロントエンドとAPIで共有する共通ロジック、Zodスキーマ、型定義
│   └── tsconfig/     # プロジェクト全体で共有する TypeScript の設定
├── package.json      # ワークスペース全体の依存関係やスクリプト定義
└── pnpm-workspace.yaml # pnpm workspace の定義ファイル
```

---

## 🚀 主要コマンド

* `pnpm dev`: ローカル開発環境の同時起動 (Next.js / Hono Workers)
* `pnpm build`: プロジェクト全体のビルド
* `pnpm check`: コード品質の一括チェック (lint, format:check, typecheck, test, build)
* `pnpm format`: Biome によるコードの自動整形
* `pnpm lint`: Biome による静的コード解析
* `pnpm test`: Vitest による単体・統合テストの実行
* `pnpm typegen`: Cloudflare Bindings の型定義生成
* `pnpm deploy`: 本番環境へのデプロイ



