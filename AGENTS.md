# AGENTS.md

これはAI Agentがこのアプリケーションを実装するための統括的な構築戦略を記したファイルです。このファイルを逐次チェックし、この通りに進めなさい。

## 開発サイクル

以下の開発サイクルで開発を行います。指示に従って開発を進めなさい。

1. Issueから実装すべきタスクを確認します。
2. 実装計画に沿って実装を行います。実装上の注意点は以下を参考にすること。
3. 実装が終わり次第、PRを投げます。
4. ユーザー及びAI AgentによるReviewを実施します。Review内容を確認後、そのReviewが妥当だと判断したもののみ修正・改善を行って都度変更を加えます。
5. すべての修正が終了次第、ユーザーがマージしますので、コードベースを更新し最新の状態にしてから次のサイクルに移ります。

## branch strategy

- プロダクションはmainブランチとする。
- 開発はdevブランチよりそれぞれブランチを切って行う。
- 不要になったローカル、リモートブランチは適宜削除する。
- ブランチ名は"feat/readme", "docs/cloudflare-workers-get-started", "fix/worker-error-fix" のように、"操作種別/内容" の形式でわかりやすくする。
- PRはのベースブランチはdevとし、mainには絶対にマージしないこと。mainはいかなる際もユーザーの指示なしにマージ、編集しないこと。

## git commit messages

- コミットメッセージは日本語で記述すること。
- 変更点をわかりやすく簡潔に記載すること。
- 必要ならばIssueと紐づけること

## PR

- PRのタイトルは日本語で記述すること
- PRのボディは日本語で詳細の変更点、変更理由、対象Issue・コードを詳細に記述すること
- PRはのベースブランチはdevとし、mainには絶対にマージしないこと。mainはいかなる際もユーザーの指示なしにマージ、編集しないこと。
- PRは必ずチェックリストを埋めてから提出すること
- PRのチェックリストはユーザーがチェックリストを修正した場合、そのチェックリストに従うこと

## Issues

- Issuesのタイトルは日本語で記述すること
- Issuesのボディは日本語で詳細の変更点、変更理由、対象Issue・コードを詳細に記述すること
- Issueには適宜関連するタグ（enhancement, bug, documentation, task,など）を付けること
- Issueのステータスは適宜更新すること
- priorityを適切に設定すること
- priorityはHighest, High, Medium, Lowのいずれかを使用すること

## subagents

- subagentsを使用する際のモデルは必ずClaude Opus又はSonnet、Gemini Pro、Flashのどれかを使用し、それ以外のモデルは使用しないこと。
- リサーチタスクなどContextの肥大化が懸念されるタスクは積極的にsubagentsを用いること。

## 技術方針

- **APIフレームワーク**: APIは必ず Hono を使用すること。
- **データベースマイグレーション**: `drizzle-kit push` は禁止する。同一D1データベースにOpenNextのtag-cacheテーブルが同居するため、スキーマ不整合を避けるために必ずマイグレーションファイルを生成して適用すること。
- **API濫用対策（二段防御）**: コストの高い生成系エンドポイントは、Cloudflare Turnstile（人間性検証, #49）→ Cookie単位レートリミット（回数制御, #17）の順で保護する。Turnstileの `site key`（公開）/ `secret key`（秘匿）は環境変数で管理し実値はコミット禁止。ローカルは未設定時にフロントが公式テストサイトキー・APIが検証バイパスで動作する（本番はsecret必須）。詳細な設定手順は `README.md` を参照。

## 主要コマンド

- `pnpm dev`: ローカル開発環境の起動（Next.jsとHono Workerの同時起動）
- `pnpm check`: コード品質の一括チェック（lint, format:check, typecheck, test, build）
- `pnpm preview:full`: OpenNextビルド及びWranglerを用いたローカル動作確認
- `pnpm deploy`: 本番環境へのデプロイ（demos Workerを先にデプロイしてから、webをデプロイする）
- `pnpm typegen`: Cloudflare Bindingsの型定義生成