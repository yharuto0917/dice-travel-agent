# 実装計画: HITL + JSON検証・永続化・バージョニング（Issue #15 + #16 統合）

## Context（なぜ）

`feat/agent-tools-and-per-day-loop`（#14）で per-day ループ・8 tools・4 subagents・`hasLlm` フォールバックは実装済みだが、以下が未達:

- **#15 HITL**: `humanInTheLoop` ツール・`awaiting_user` 遷移・`answerQuestion` 本実装・**タイムアウト/キャンセル**が未実装。`agent.ts` の `AgentState.questions`/`phase:"awaiting_user"`、フロント `generating/page.tsx` の `HitlQuestionCard`+`answerQuestion` 配線は土台として既存。
- **#16 検証・永続化**: `validation/checker.ts`/`fix.ts`、finalize での checker→fix→D1永続化、**取得API（GET）**、**バージョニング（履歴/差分）**、**部分失敗時の安全な保存** が未実装。`itinerary/page.tsx` は `FlowPlaceholder` のままで D1 を読んでいない。`TravelPlanSchema`（完成スキーマ）は `@repo/shared` に実在。

`#16` の最終確定で fix が失敗した際の**HITLエスカレーション**が `#15` の HITL 基盤に依存するため、両 Issue は技術的に密結合する。よって**1ブランチ・1PRに統合**してデリバリする（ユーザー承認済み）。既存の `docs/agent-flow-implementation-plan.md`（#14中心）の後続を成す。

## 確定した設計決定（ユーザー承認済み）

1. **デリバリ単位**: #15 + #16 を **1ブランチ `feat/hitl-validation-persistence` / 1 PR** に統合。base は #14 マージ後の `main`（未マージ間は `feat/agent-tools-and-per-day-loop` にスタック）。
2. **バージョニング**: **フル実装**。`plan_versions` スナップショットテーブル + 差分計算（`diff.ts`）+ 復元API（POST /plans/:id/restore）まで。チャット編集（#20）が乗る土台を完成させる。
3. **テーブル構成の確定（Issue #16 との齟齬解消）**: Issue #16 の `plans`/`plan_days`/`plan_items`/`images` のうち、**計画本体は `plans.plan` JSONカラムを単一の真実**とする既存設計（`db/schema.ts` 冒頭コメント・`agent-flow-implementation-plan.md` line 191）を踏襲し、`plan_days`/`plan_items` の正規化テーブルは**作らない**。`images` は既存。今回の新規テーブルは**バージョニング用 `plan_versions` のみ**。
4. **HITL タイムアウト方針**: `awaiting_user` 入りで `schedule(HITL_TIMEOUT_SEC, "hitlTimeout", …)` を仕掛け、未回答のまま期限到来時は該当質問を `skipped` にして**同 index の runStep を再開**（破綻せず既定値で続行）。キャンセルは `skipQuestion(id)` で即時 skip。

## Issue → 実装の対応

### Issue #15（HITL）

| Issue チェック項目 | 実装 |
|---|---|
| 質問が必要な分岐で一時停止 | `humanInTheLoop` ツール（`HITL_PENDING` センチネル）→ `stopWhen` の HITL 述語で `generateText` 停止 → `runDay` が `{status:"hitl", questions}` を返す |
| 質問をHITLキューに積みクライアント通知 | `hitl/questions.ts` ヘルパー → `setState({ phase:"awaiting_user", questions:[...] })`（WebSocket 同期） |
| フロント: 質問カード表示・回答送信 | `generating/page.tsx` の `HitlQuestionCard`（既存）+ **スキップボタン追加**（最小） |
| 回答受領→Agent再開、**タイムアウト/キャンセル** | `answerQuestion` 本実装（全回答で `resumeIndex` の runStep 再 schedule）/ `hitlTimeout` ハンドラ / `skipQuestion` callable |
| 複数質問のキューイングと履歴保持 | `questions[]` に `pending/answered/skipped` を保持（履歴）。表示は `pending` フィルタ。`hitl/questions.ts` で一元操作 |

### Issue #16（検証・永続化・バージョニング）

| Issue チェック項目 | 実装 |
|---|---|
| スキーマ充足チェック（未充填検出） | `validation/checker.ts`: `TravelPlanSchema.safeParse` + 意味的検証 |
| 不足時の追加収集/再生成 or HITLエスカレーション | `validation/fix.ts`: `generateObject` 修復 N回 → 失敗時 **HITLエスカレーション**（#15基盤）→ 決定的フォールバック |
| D1保存と**取得API** | `db.update(plans)` + `routes/plans.ts` に **GET /:id ほか追加**。`itinerary/page.tsx` を D1取得描画へ |
| **バージョニング（履歴/差分）** | `plan_versions` テーブル + 更新時スナップショット + `diff.ts` 差分 + GET versions/diff + POST restore |
| エラー/リトライ・**部分失敗時の安全な保存** | 既存 schedule 3回リトライ + 上書き前に旧版を `plan_versions` へ退避し draft を喪失させない |

## ブランチ / PR

- ブランチ: `feat/hitl-validation-persistence`（base: #14 マージ後の `main`、未マージ間はスタック）。
- 1 PR（日本語タイトル/ボディ、Co-Author禁止）。終了後ブランチ削除。
- D1スキーマ変更を伴うため `pnpm db:generate` → `wrangler d1 migrations apply`（**`drizzle-kit push` 禁止**）。マイグレーション適用はユーザー作業。

## モジュール / ファイル構成

```
apps/api/src/
  agents/
    hitl/
      questions.ts            # NEW HITLキュー純ヘルパー（make/merge/pending/allAnswered）
      questions.test.ts       # NEW
    tools/
      human-in-the-loop.ts    # NEW humanInTheLoop ツール（HITL_PENDINGセンチネル, ctx.hitlへpush）
      human-in-the-loop.test.ts # NEW
      context.ts              # CHANGE ToolContext に hitl コレクタ（pending質問 + 回答済みマップ）追加
    flow/
      orchestrator.ts         # CHANGE humanInTheLoop登録 / stopWhenにHITL述語 / runDay戻り値を判別共用体化
      judgement.ts            # CHANGE HITL stop述語・HITL_TIMEOUT_SEC・FIX_MAX_ATTEMPTS 定数
      prompts.ts              # CHANGE HITL誘導文 + 回答済みQ&Aをプロンプトへ反映
    validation/
      checker.ts              # NEW 構造(safeParse)+意味的検証 → {valid,errors,parsed?}
      checker.test.ts         # NEW
      fix.ts                  # NEW generateObject修復ループ → HITLエスカレーション/決定的フォールバック
      fix.test.ts             # NEW
      diff.ts                 # NEW plan版間の構造化差分（追加/削除/変更）
      diff.test.ts            # NEW
    travel-planning-agent.ts  # CHANGE finalize刷新, HITL分岐(awaiting_user/no-schedule), answerQuestion本実装,
                              #        skipQuestion/hitlTimeout, restore永続化, version採番
    pipeline.ts               # CHANGE 役割整理（LLM未設定フォールバック専用と明記）
  routes/
    plans.ts                  # CHANGE GET /:id, GET /:id/versions, GET /:id/diff, POST /:id/restore 追加
    plans.test.ts             # NEW 所有者スコープ・取得・復元・差分
  db/
    schema.ts                 # CHANGE plan_versions テーブル + plans.version カラム
    migrations/<gen>.sql      # NEW db:generate 生成
packages/shared/src/schemas/
  agent.ts                    # CHANGE AgentState に resumeIndex?:number|null, awaitingSince?:string|null
  api-dto.ts (or plan.ts)     # CHANGE PlanVersion / GetPlanResponse / PlanDiff DTO
  schemas.test.ts             # CHANGE 追加フィールドのテスト
apps/web/
  app/itinerary/page.tsx      # CHANGE D1取得→しおり描画（FlowPlaceholder撤去）
  app/generating/page.tsx     # CHANGE スキップボタン等の最小追加
  lib/api.ts                  # CHANGE getPlan/getPlanVersions/restorePlanVersion/getPlanDiff
```

各新規ロジックの `*.test.ts` は同ディレクトリ（`apps/api/src/**`）に置く（`vitest.config.ts` include は `{apps,packages}/*/src/**`）。

## #15 HITL 詳細設計

### 状態 / スキーマ
- `AgentState` に追加: `resumeIndex: number | null`（HITL/タイムアウト後に再開する runStep の index）、`awaitingSince: string | null`（タイムアウト判定の起点ISO、任意）。client同期されるが内部用途で無害。
- `HitlQuestion`（既存）: `{ id, question, options?, answer, status: pending|answered|skipped }` をそのまま使用。
- `ToolContext.hitl`: `{ pending: HitlQuestion[]; answers: Record<questionId|key, string> }`。tool が pending に push、再開時は answered を answers に積んでプロンプトへ反映。

### humanInTheLoop ツール
- `inputSchema { question: string, options?: string[] }`。`execute`: `id=crypto.randomUUID()` の `HitlQuestion`(pending) を `ctx.hitl.pending` に push → `"HITL_PENDING"` センチネル文字列を返す。
- `orchestrator.ts`: `allTools` に追加し `stopWhen` に `() => ctx.hitl.pending.length > 0` を追加。
- `runDay` の戻り値を判別共用体化: `type RunDayResult = { status:"ok"; day: PlanDay } | { status:"hitl"; questions: HitlQuestion[] }`。HITL 停止時は `pending` を返し、**`mergeDay` も `finalizeDay` フォールバックも実行しない**。

### runStep の HITL 分岐（planDay / finalize 共通）
1. `runDay` が `status:"hitl"` → `setState({ phase:"awaiting_user", questions:[...existing, ...new], resumeIndex:index, awaitingSince:now })`、**次 step を schedule しない**。`schedule(HITL_TIMEOUT_SEC, "hitlTimeout", {index, ids})`。
2. `status:"ok"` → 従来通り `mergeDay` → 次 step schedule。

### 再開・タイムアウト・キャンセル
- `answerQuestion(id, answer)`（既存callable拡張）: 該当を `answered` 化。**残 pending が無ければ** `phase` を `designing` に戻し `runStep({index: resumeIndex})` を再 schedule、`resumeIndex=null`。冪等 merge（dayNumber単位置換）で再実行安全。
- `skipQuestion(id)`（NEW callable）: `skipped` 化 → 同上の再開判定。
- `hitlTimeout({index, ids})`（NEW handler）: 発火時に `phase==="awaiting_user"` かつ対象が未回答なら `skipped` にして再開。回答済みなら no-op（ガード）。「タイムアウト時に破綻しない」を満たす。
- 再開時の prompt: `prompts.ts` が `ctx.hitl.answers`（回答済みQ&A）を本文に差し込み、モデルが同じ質問を再発行しないようにする。

### judgement / system
- `DAY_PLANNER_SYSTEM` に追記: 「本質的な情報が曖昧で安全に進められない場合のみ `humanInTheLoop` を1回呼び、簡潔な質問（必要なら選択肢）を出して停止せよ。些末な判断では呼ぶな」。
- 定数: `HITL_TIMEOUT_SEC`（MVP 例 180）、`FIX_MAX_ATTEMPTS=2` を `judgement.ts` に集約。

### フロント（最小）
- `generating/page.tsx`: `HitlQuestionCard` に**スキップボタン**追加（`agent.stub.skipQuestion(id)`）。`awaiting_user` は `PHASE_LABELS` に既存（"確認をお願いします"）。タイムアウトはサーバ側で自動解消するためカウントダウン表示は任意（MVP省略可）。

## #16 検証・永続化・バージョニング 詳細設計

### checker.ts
- `checkPlan(plan: TravelPlanDraft): { valid; errors: string[]; parsed?: TravelPlan }`。
- 構造: `TravelPlanSchema.safeParse(plan)`（必須充足を強制）。
- 意味的: `days.length === nights+1`、各日 `items.length>0`、`budget.total` が conditions 予算レンジ内、`destination`/`conditions` 充足。errors は日本語。

### fix.ts
- `fixPlan(env, plan, errors, attempts=FIX_MAX_ATTEMPTS): Promise<TravelPlan | null>`。
- `generateObject({ schema: TravelPlanSchema, system, prompt: 現plan+errors })` → 再 `checkPlan`。成功で `parsed` 返却、N回失敗で `null`。
- `null` 時 caller（finalize）が **HITLエスカレーション**（不足項目を質問）→ skip/timeout なら**決定的フォールバック**（最小限の valid 値で埋め `status:"completed"` を保証）。

### finalize step（runStep）
1. `checkPlan` → invalid なら `fixPlan`。
2. なお invalid → HITLエスカレーション（#15分岐へ）or 決定的フォールバック。
3. **部分失敗時の安全な保存**: 上書き前に現 `plans.plan` を `plan_versions` へスナップショット（version+1）。
4. valid: `db.update(plans).set({ plan: validPlan, status:"completed", title, version, updatedAt })`。
5. `setState({ phase:"done", progress:1 })`。

### バージョニング（フル）
- スキーマ追加:
  ```
  plan_versions: { id pk, planId fk→plans.id (idx), version int, plan json, label text?, createdAt }
  plans.version: integer notNull default 1   // 現行版ポインタ
  ```
- スナップショット: finalize / restore / （将来 #20 のチャット編集）で更新前の plan を `plan_versions` に退避し version 採番。
- 差分 `diff.ts`: `diffPlans(a: TravelPlan, b: TravelPlan): PlanDiff`。日・アイテム単位で added/removed/changed を構造化（純関数・テスト容易）。
- 復元: `POST /plans/:id/restore { version }` → 現行を退避→当該版を `plans.plan` に復元→version 採番→更新後 plan 返却。clientId スコープ。
- D1 マイグレーション: `pnpm db:generate` → `wrangler d1 migrations apply`（push 禁止）。

### 取得API（routes/plans.ts）
- `GET /plans/:id` → clientId 所有チェック → plan行（plan/status/title 等）。非所有は 404。
- `GET /plans/:id/versions` → 版メタ一覧。
- `GET /plans/:id/diff?from=&to=` → `diffPlans` の結果。
- `POST /plans/:id/restore` → 上記復元。
- `lib/api.ts`: `getPlan(id)`/`getPlanVersions(id)`/`restorePlanVersion(id,v)`/`getPlanDiff(id,from,to)` を追加（`apiJson` 利用）。

### itinerary ページ
- `FlowPlaceholder` を撤去し、`planId`（query）で `GET /plans/:id` を取得して `TravelPlan` を描画（days/items/budget/images）。`generating` の `PlanPreview` 相当を再利用。loading/error 状態あり。

## コスト/ガードレール

- `humanInTheLoop` は「本質的曖昧時のみ1回」を system で強制し乱用を抑止。`ctx.usage` は HITL 呼びも tool 計上。
- fix は `FIX_MAX_ATTEMPTS` で上限。失敗は必ず決定的フォールバックで `status:"completed"` に着地（無限ループ/未完了を防ぐ）。
- バージョニングは更新毎スナップショットで書き込み増だが MVP 規模では許容。

## 検証

### ユニット（LLMモック）
- `hitl/questions.ts`（pending/allAnswered/merge）。
- `humanInTheLoop`（pending push + センチネル）。
- `runDay` の HITL 中断パス（`humanInTheLoop` を呼ぶ MockLanguageModelV2 → `status:"hitl"`）。
- `answerQuestion`/`skipQuestion`/`hitlTimeout` の再開・冪等（同 index 再実行で重複なし）。
- `checker.ts`（valid/invalid・意味的）、`fix.ts`（モック修復）、`diff.ts`（純差分）。
- `routes/plans.ts`（所有者スコープ・GET取得・versions・restore）。

### E2E ローカル
1. `.dev.vars` に `GEMINI_API_KEY`（Google AI Studio 鍵）＋ `AI_GATEWAY_TOKEN`（認証必須 Gateway 用 CF API トークン）、`wrangler d1 migrations apply` 済み。パススルー方式（x-goog-api-key ＋ cf-aig-authorization 併送）。
2. 曖昧条件で生成 → `awaiting_user`+questions が WebSocket 同期 → 回答で再開完走 / 無回答放置で `hitlTimeout` により skip 完走。
3. 完成計画が `TravelPlanSchema` 検証通過 → status=completed で D1 保存 → `GET /plans/:id` 取得 → `/itinerary` が D1 から表示。
4. plan 更新で `plan_versions` にスナップショット → `GET versions/diff`・`POST restore` 動作。

### 品質ゲート
- `pnpm check`（biome + typecheck + vitest + build）緑。

## 受け入れ条件（PR）

- 曖昧条件で質問がUIに出て、回答すると再開・完走する。スキップ/タイムアウトでも破綻せず完走する（#15）。
- 完成計画がスキーマ検証を通り D1 に保存・**再取得**でき、`/itinerary` が D1 から表示される（#16）。
- 計画更新で**履歴が `plan_versions` に積まれ、差分取得・復元**ができる（#16 バージョニング）。
- fix が欠落 plan を修復する単体テスト、checker/diff/hitl helpers の単体テストが緑。

## リスク / 注意

- **D1 マイグレーション**: `db:generate`→`wrangler d1 migrations apply` を使用（`drizzle-kit push` 禁止）。適用はユーザー作業。
- **runDay の HITL 判別**: 通常 finalize と HITL 中断を判別共用体で明確に分離（混同すると空の日をマージする）。
- **タイムアウト alarm のガード**: `hitlTimeout` 発火時に既回答なら no-op（二重再開防止）。
- **AgentState 肥大**: `resumeIndex`/`awaitingSince` は client 同期されるが内部用途で無害。ドキュメント化する。
- **fix 無限化防止**: N回失敗は必ず決定的フォールバックへ着地。
- `.env`/`.dev.vars` は変更・コミットしない。
