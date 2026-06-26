# 実装計画: マルチエージェント Agent Flow（Issue #14 → #15 → #16 → #20）

## Context（なぜ）

旅行プランニングAgent（`TravelPlanningAgent` Durable Object）は #13 でスケジュール駆動の骨格が完成しているが、計画生成の中身は**決定的なダミーデータを返す純関数パイプライン**（`PLAN_PIPELINE` 8ステップ）にすぎず、外部APIもLLMも一切呼んでいない。外部APIクライアント7種（#12/PR#44）は実装済みだが**どこからも呼ばれていない**。AI Gateway バインディング設定はあるが Gemini 呼び出しコードは皆無。

本計画は、ユーザーが確定した **Mermaid Agent Flow** を実装し、骨格を「AIが外部ツールを動的に呼びながら計画JSONを段階構成する本物のマルチエージェント」へ刷新する。スコープは Mermaid 全体（= Issue #14/#15/#16/#20 にまたがる）だが、AGENTS.md の「1 Issue = 1ブランチ = 1 PR」に従い、**全体アーキを一貫設計したうえで4本のPRに分割**して順次デリバリする。

成果: 条件入力からツール/サブエージェント呼び出しを伴って計画JSONが動的に構成され、AI Gateway 経由で Gemini が呼ばれ observability に記録され、生成後はチャットで編集/質問でき、最終JSONはスキーマ検証され D1 に永続化される。

## 確定した設計決定（ユーザー承認済み）

1. **スコープ**: Mermaid 全体。ただし PR は #14→#15→#16→#20 の順に分割。
2. **アーキテクチャ**: #13 の固定8フェーズ純関数パイプラインを **per-day ループに刷新**。`setup`（理解+情報収集）→ `planDay(n)`（1日=1スケジュールDOステップ、AI SDKマルチステップtool calling）→ `finalize`。durable実行・3回リトライ・冪等性は既存パターンを完全踏襲。
3. **サブエージェント**: research/enhancement/factcheck/summarize は **subagent-as-tool**（各々 AI SDK `tool()`、`execute` 内で独自 instructions + 独自ツールサブセットの `generateText`）。

## Mermaid → 実装の対応

| Mermaid 要素 | 実装 |
|---|---|
| SupervisorAgent（入力受領・ルーティング） | DO の `start()`（初回生成）/ `chat()`（2回目以降, 新規 @callable） |
| Main Loop（while days.length==count） | `runStep` を per-day化。`planDay(n)` を dayCount 回 schedule |
| Agent judgement（full info?/20 tool/15 subagent/opt14 stop） | day-planner の `generateText` の system指示 + `stopWhen`（stepCount + usageカウンタ上限 + `finalizeDay` 呼び出し検出） |
| opt1〜13 capability | 8 tools + 4 subagents（Capability Pool） |
| opt14 stop loop → insert day | `finalizeDay` ツール（`{ day: PlanDay }` を構造提出）→ `mergeDay` で plan に冪等マージ |
| JSON Format checker / fix JSON agent | `validation/checker.ts`（`TravelPlanSchema` 検証）/ `validation/fix.ts`（`generateObject` 修復） |
| Intent（edit/question/unrelated） | `supervisor/intent.ts`（`generateObject` 分類） |
| Edit Loop | `supervisor/edit.ts`（planDayループ再利用）→ re-validate |
| QA（answer or search subagent→answer） | `supervisor/qa.ts` |
| Warning（unrelated） | 固定文言応答（LLM不要） |
| Human in the loop | `humanInTheLoop` ツール → pending質問をqueueへ → `awaiting_user` 停止 → `answerQuestion` で再開 |

## LLMプロバイダ配線（Gemini via Cloudflare AI Gateway）

**方式（推奨）**: `@ai-sdk/google` の `createGoogleGenerativeAI({ apiKey, baseURL })` を Cloudflare AI Gateway の google-ai-studio エンドポイントに向ける。`ai-gateway-provider` ラッパより依存が少なく、Google ネイティブ型がそのまま使え、observability は AI Gateway 経由で自動記録。

- 依存追加（`apps/api`）: `pnpm --filter @repo/api add ai @ai-sdk/google`（apps/web は `ai@^6` 導入済み）。
- 新規ファイル `apps/api/src/agents/llm/provider.ts`:
  - `GEMINI_MODEL_ID = "gemini-3.5-flash"`（gemini-api-dev skill で現行最新と確認済）。
  - `baseURL = https://gateway.ai.cloudflare.com/v1/${AI_GATEWAY_ACCOUNT_ID}/${AI_GATEWAY_NAME}/google-ai-studio/v1beta`
  - `createLlm(env)` → `createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY, baseURL })(GEMINI_MODEL_ID)`、`hasLlm(env)` → `Boolean(env.GEMINI_API_KEY)`。
  - **load-bearing 注意**: `@ai-sdk/google` が baseURL に `v1beta/models/...` を自前付与する場合、`v1beta` の二重付与で 404 になる。**実装時に `node_modules/@ai-sdk/google` で組み立てを1度確認**し、`provider.test.ts` で実 baseURL を assertion 固定する。
- env/secret 変更:
  - `apps/api/src/env.ts` の `Bindings` に `GEMINI_API_KEY?: string;` を追加（既存外部APIキー群と同列）。**wrangler.json は変更不要**（`AI_GATEWAY_*` は既存、手書き Bindings 型なので typegen 不要）。
  - secret 投入はユーザー作業: ローカルは `apps/api/.dev.vars` に `GEMINI_API_KEY=...`、本番は `wrangler secret put GEMINI_API_KEY`。
- **フォールバック安全弁**: `hasLlm(env)` が false の間は **既存 `PLAN_PIPELINE` で完走**させる（キー未設定でも骨格が回り、#14 で回帰しない）。

## モジュール/ファイル構成（apps/api/src/agents/ 配下に新設）

```
agents/
  travel-planning-agent.ts   # 既存DO。runStep刷新 + chat()/answerQuestion本実装
  pipeline.ts                # 既存。LLM未設定時フォールバック & dayCountヘルパー流用。#16完了時に整理
  llm/provider.ts            # Gemini(AI Gateway) model factory + hasLlm
  flow/
    step-plan.ts             # index→{setup|planDay(n)|finalize} 解決。buildStepPlan(conditions)
    orchestrator.ts          # runDay(): per-dayのgenerateText（マルチステップtool calling）
    merge.ts                 # mergeDay(plan, day): dayNumber単位の冪等置換（appendItem思想を一般化）
    judgement.ts             # UsageCounter（tool/subagent計上）+ stopWhen述語
    prompts.ts               # system/instructions（setup/day-planner/intent/qa/fix/research…）
  tools/
    index.ts                 # buildTools(env, ctx): 8 tools を返すファクトリ
    context.ts               # ToolContext型（clients, destPoint, conditions, usage）
    {tourist-spot,hotel,restaurant,transportation,weather,image}-search.ts
    google-maps.ts           # geocoding.geocode ラップ
    calculate.ts             # 純計算（合計/予算配分/距離）
  subagents/
    index.ts                 # buildSubagents(env, ctx): 4 subagent-as-tool
    {research,enhancement,factcheck,summarize}.ts
  supervisor/
    intent.ts                # generateObject分類
    edit.ts                  # Edit Loop（planDayループ再利用）
    qa.ts                    # QAループ
  validation/
    checker.ts               # TravelPlanSchema検証 + 意味的未充足検出
    fix.ts                   # generateObject修復 / HITLエスカレーション
  hitl/questions.ts          # HITLキュー操作ヘルパー
routes/chat.ts               # (#20) POST /plans/:id/chat → DO.chat() 委譲（任意の薄い委譲）
```
各新規ロジックには `*.test.ts` を **同ディレクトリ（`apps/api/src/agents/**`）** に置く（`vitest.config.ts` の include は `{apps,packages}/*/src/**`。src外だと拾われない）。

## ツール定義（8 tools, Capability Pool）

- **env/clients の渡し方**: `tool().execute` はクロージャで env/clients を受ける。DO で1リクエストごとに `buildTools(env, ctx)` を呼び、`createClients(env)`（`apps/api/src/clients/index.ts`）の結果 + `ToolContext`（行き先GeoPoint・conditions・usageカウンタ）を束ねる。**ファクトリ化**して env をグローバルに漏らさずリクエストスコープに閉じる（Workers ベストプラクティス）。
- **inputSchema は Zod**（AI SDK v5+ は `parameters` ではなく `inputSchema`）。各 execute は薄いアダプタに徹し、冒頭で `ctx.usage.tool()` を計上。clients が既に KVキャッシュ/5sタイムアウト/3回リトライ/キー無→空配列フォールバックを内包。

| tool | ラップ元（既存クライアント） | inputSchema → 出力 |
|---|---|---|
| touristSpotSearch | `poi.searchNearby(lat,lng,radius=1000)` | `{lat,lng,radius?}` → `Poi[]` |
| hotelSearch | `lodging.searchHotels(lat,lng,radiusKm=3.0)` | `{lat,lng,radiusKm?}` → `Lodging[]` |
| restaurantSearch | `restaurant.searchRestaurants(lat,lng,range=3,count=10)` | `{lat,lng,range?:1..5,count?:1..20}` → `Restaurant[]` |
| transportationSearch | `transit.getDirections(from,to,fromName,toName,mode)` | `{from,to,fromName,toName,mode?}` → `TransportLeg[]` |
| weather | `weather.getForecast(lat,lng)` | `{lat,lng}` → `WeatherDaily[]` |
| imageSearch | `image.searchImages(query,limit=5)` | `{query,limit?}` → `ImageResult[]`（帰属を attribution へ写す） |
| googleMaps | `geocoding.geocode(query)` | `{query}` → `GeoPoint\|null` |
| calculate | 純関数（外部API不要） | `{op:"sum"\|"budgetSplit"\|"distanceKm", values...}`（離散オペ列挙。任意式評価は避ける） |

## subagent-as-tool（4 subagents）

各々 `tool()`。`execute` 内で独自 instructions + 独自ツールサブセットの `generateText`（`stopWhen: stepCountIs(小)` でコスト制御）。冒頭で `ctx.usage.subagent()` 計上。

| subagent | 責務 | 与えるツール | inputSchema → 出力 |
|---|---|---|---|
| research | 行き先/テーマ深掘り（候補・名物・季節性） | touristSpotSearch, restaurantSearch, weather, googleMaps | `{topic, around?}` → `{findings, candidates?}` |
| enhancement | PlanItem の description/タイトル強化 | imageSearch（任意） | `{items: PlanItem[]}` → `{items}` |
| factcheck | 整合性検証（時間重複/移動非現実/予算超過） | transportationSearch, calculate | `{day, budget?}` → `{issues[], ok}` |
| summarize | 1日/全体の要約（summary・チャット応答用） | なし | `{plan\|day}` → `{summary}` |

`buildSubagents(env, ctx)` の結果を `buildTools` とマージして day-planner の `tools` に合流（= 全ループ共有の Capability Pool）。

## per-day オーケストレーション（中核）

`travel-planning-agent.ts` の `runStep({index})` を刷新（schedule自己駆動は維持）:

1. `loadPlanRow()`（既存メモリキャッシュ）で conditions/destinationPref 取得。
2. `hasLlm(env)` false → **既存 `PLAN_PIPELINE` フォールバック**（現 runStep 相当）。
3. true → `buildStepPlan(conditions)` で step種別を解決し分岐:
   - **setup**: `geocode(destinationPref)` で `destPoint`、`weather.getForecast`、初期 `research` で全体方針。`plan.title/summary/nights/days[]`（空 days を `dayCount=nights+1` 分）を確定し `setState`（phase: collecting/designing）。
   - **planDay(n)**: `runDay(env, ctx, plan, n)` を呼び `PlanDay` を構築 → `mergeDay(plan, day)` → `setState`（phase: 該当日フェーズ, filledSections, progress）。
   - **finalize**: checker → fix → D1永続化（§ JSON検証）→ `setState`（phase: done, progress 1）。
4. 末尾で `schedule(STEP_DELAY_SEC, "runStep", {index:index+1}, {retry:{maxAttempts:3}})`（既存と同一）。

`runDay`（orchestrator.ts）:
```
generateText({
  model: createLlm(env),
  system: DAY_PLANNER_SYSTEM,                 // 役割・制約・opt14=finalizeDayの使い方
  prompt: dayPlannerPrompt(plan, n, ctx),     // 行き先/条件/既決の他日/天気/残予算
  tools: { ...buildTools(env,ctx), ...buildSubagents(env,ctx), finalizeDay },
  stopWhen: [ stepCountIs(MAX_STEPS),
              () => ctx.usage.toolCalls>=MAX_TOOL_CALLS || ctx.usage.subagents>=MAX_SUBAGENTS,
              hasFinalizeDayCall ],
  prepareStep: maybeInjectHitl,               // 情報不足→HITL（§HITL）
})
```
- **judgement**: 「full info?/20 tool/15 subagent」は system指示 + `stopWhen` 述語 + `ctx.usage` カウンタの複合で表現（回数上限はモデル任せにせずハード強制）。「十分」とモデルが判断→ `finalizeDay`（opt14）を呼ぶよう誘導。
- **finalizeDay**（opt14）: inputSchema `{ day: PlanDaySchema }`。呼ばれたらループ停止しその引数を `PlanDay` 採用。未呼び出しで stepCount 上限到達時は `generateObject` で1回 `PlanDay` を確定するフォールバック。
- **冪等**: `mergeDay` は `plan.days[n-1]` を **dayNumber単位で置換**（同一indexのリトライで重複なし）。`ctx.usage` はステップ内ローカル（リトライ時リセット = 上限の意味を「1日あたり」に保つ）。
- **durable/実行時間**: 1日=1ステップで `generateText` の wall-time をステップ分割し DO 実行時間上限に収める。各日完了で `setState` → フロントが per-day でリアルタイム表示。

## Supervisor / Intent / Edit / QA（2回目以降・#20統合）

DO に `@callable() async chat(message: string)` を追加（フロントは既存 `agent.stub` 経由で呼べ、WebSocket同期もそのまま）:
1. user メッセージを `chatMessages`（role:"user"）保存。
2. **Intent分類**（`intent.ts`）: `generateObject({ schema: z.object({ intent: z.enum(["edit","question","unrelated"]), rationale }) })`。
3. 分岐:
   - **edit** → 現 plan ロード→ `runDay` を編集対象日に再走（または全体編集は setup 相当）→ re-validate（checker）→ 永続化 → `summarize` で差分要約を応答。
   - **question** → plan文脈だけで answer。不足時 `research` を1回呼んでから answer（plan不変）。
   - **unrelated** → 固定文言 Warning（LLM呼び出し0）。
4. assistant 応答を `chatMessages` 保存 + `setState` 同期。

レート: `rateLimits` scope:"chat"（20回/日）と #17 で接続。

## JSON checker + fix + 永続化（#16）

- `checker.ts`: `TravelPlanSchema.safeParse(plan)`（**完成スキーマで必須充足を強制**）+ 意味的検証（`days.length===nights+1`、各日 items 有無、`budget.total` が予算範囲内、destination/conditions 充足）→ `{valid, errors[]}`。
- `fix.ts`: invalid 時、軽微欠落は `generateObject({ schema: TravelPlanSchema, prompt: 現plan+errors })` で修復→再 checker。N回（MVP 2回）失敗で HITL エスカレーション or 決定的フォールバックで `status:"completed"` を確保。
- 永続化（finalize 末）: valid なら `db.update(plans).set({ plan: validPlan, status:"completed", title, updatedAt })`（key=`this.name`=planId）→ `setState`。/itinerary が D1 から読む。

## HITL（#15）

- 判断点: setup/planDay の judgement で情報不足/曖昧を検出。
- `humanInTheLoop` ツール: execute が `HITL_PENDING` センチネル返却 → `stopWhen` で検出し即停止 → DO が `setState({ phase:"awaiting_user", questions:[...pending] })`、**次stepを schedule せず保留**。
- 再開: 既存 `answerQuestion(id, answer)` を本実装。該当質問を answered にし、`phase` を戻して**同じ index の runStep を再 schedule**（answer を ctx 注入）。冪等 merge で再実行は安全。
- フロント: `/generating` は既に `state.questions` 表示 + `agent.stub.answerQuestion()` 導線あり（配線追加は最小）。

## コスト/レート/並列（ガードレール）

- **保守的デフォルト**: `MAX_STEPS=8`（1日あたり）、`AGENT_MAX_TOOL_CALLS=12`（理論20の半分以下）、`AGENT_MAX_SUBAGENTS=5`（理論15→5）。定数として `flow/judgement.ts` に集約。
- 並列: AI SDK は同一ステップ内の複数 tool call を並行実行。day-planner system で「同じ日の検索はまとめて呼べ」と誘導。
- AI Gateway キャッシュ + 各 client の KVキャッシュで外部API/LLMコスト抑制。
- レート（#17）: plan スコープ（2回/日）は生成開始時、chat スコープ（20回/日）は chat() 各回で `rateLimits` 加算/検査。

## PRシーケンス（ベース: dev、日本語タイトル/ボディ、Co-Author禁止）

1. **PR #14 `feat/agent-tools-and-per-day-loop`**: `llm/provider.ts`, `tools/*`, `subagents/*`, `flow/*`, `env.ts` に `GEMINI_API_KEY`、`runStep` を setup/planDay/finalize に刷新（`hasLlm` false でフォールバック）。finalize は当面 `status:"completed"` のみ、HITLツールは登録するが pending を積むだけ。
   - 受け入れ: `pnpm check` 緑。LLMモックで runDay/merge/tools 単体テスト。`.dev.vars` にキーありで `POST /plans`→WebSocketで per-day に setState が流れ days が条件通りの日数で充填。キー無しで従来骨格が完走。AI Gateway observability に Gemini 呼び出しが記録。
2. **PR #15 `feat/hitl`**: `hitl/questions.ts`、`humanInTheLoop` pending化、`answerQuestion` 本実装、judgement 発火、`awaiting_user` 遷移と再 schedule。
   - 受け入れ: 曖昧条件で `awaiting_user`+questions 同期→回答で再開完走。HITLセンチネル→stop→再実行の冪等テスト。
3. **PR #16 `feat/json-validation-and-persistence`**: `validation/checker.ts|fix.ts`、finalize で checker→fix→`db.update(plans)`。`pipeline.ts` の役割整理。
   - 受け入れ: `plans.plan` に valid な `TravelPlan` が status=completed で保存。欠落 plan を fix が修復する単体テスト。/itinerary が D1 から表示。
4. **PR #20 `feat/chat-edit-qa`**: `supervisor/intent.ts|edit.ts|qa.ts`、DO `chat()`、`routes/chat.ts`（任意）、`chatMessages` 保存、レート連携準備。
   - 受け入れ: `chat("2日目を温泉中心に")`→edit→再検証→更新+差分要約。`chat("予算は？")`→question→answer（plan不変）。`chat("今日の天気は？")`→unrelated→Warning。履歴蓄積。

## 再利用する既存資産

- `apps/api/src/clients/index.ts` `createClients(env)` — 全ツールの実データ源（再実装しない）。
- `apps/api/src/agents/pipeline.ts` の `dayCountOf/nightsOf/destOf/jpy/appendItem` — `flow/` へ移設/流用。`appendItem` 思想を `mergeDay` に一般化。
- `apps/api/src/agents/travel-planning-agent.ts` の `loadPlanRow()`/`cachedRow`/`schedule`/`validateStateChange`/`onError` — そのまま踏襲。
- `packages/shared/src/schemas/plan.ts` `TravelPlanSchema`/`PlanDaySchema`/`PlanItemSchema` — `finalizeDay` inputSchema・checker の基盤。
- `apps/api/src/db/schema.ts` `plans`/`chatMessages`/`rateLimits` — D1スキーマ変更は不要（列追加が必要になったら `db:generate`→`wrangler d1 migrations apply`、`drizzle-kit push` 禁止）。
- フロント `apps/web/app/generating/page.tsx`（useAgent/start/answerQuestion）・`apps/web/lib/agent.ts`（PHASE_LABELS/SECTION_LABELS）— 配線追加は最小。

## 検証

- **ユニット（LLMモック）**: `createLlm` を DI 可能にし、テストは `MockLanguageModelV2` か tool execute を直接呼ぶ。対象: 各 tool の inputSchema/execute（`createClients` スタブ）、`mergeDay` 冪等性、`buildStepPlan` ステップ数、`checker`/`fix`、`intent` 分類、`provider` の baseURL 組み立て。
- **E2E ローカル**:
  1. `apps/api/.dev.vars` に `GEMINI_API_KEY=...`（+任意で外部APIキー）。
  2. `pnpm dev`（Next+Worker 同時起動）。
  3. `/conditions` から作成 or `curl -X POST localhost:8787/plans -d '{CreatePlanRequest}'` で planId。
  4. `/generating?planId=...` で `phase` が setup→planDay×N→finalize→done と進み `plan.days` が逐次充填されるのを WebSocket で確認。
  5. `/itinerary` 表示、`chat` で edit/question/unrelated 検証。
- **品質ゲート**: 各PRで `pnpm check`（biome + typecheck + vitest + build）を緑に。

## リスク/注意

- `@ai-sdk/google` の baseURL `v1beta` 二重付与 → 404。実装時に node_modules で確認し provider.test.ts で固定。
- `tool()` は `inputSchema`（`parameters` は旧称）。
- env はグローバルに置かず `buildTools(env, ctx)` でリクエストスコープに閉じる。
- 20/15 の理論上限はコスト過大。MVP は半分以下のデフォルトで開始し、observability を見て調整。
- LLM未設定フォールバック（既存 PLAN_PIPELINE）を #14 で温存し回帰リスクを排除。
