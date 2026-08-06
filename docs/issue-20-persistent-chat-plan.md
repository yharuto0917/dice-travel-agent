# Issue #20 常駐Geminiチャット 実装計画

> 対象Issue: [M5・20] 常駐Geminiチャット（AI Elements・計画修正/質問・mobile=ボトムドロワー）

## 背景

Issue #20（M5）は「しおり画面に常駐する Gemini チャットで、追加質問と計画修正を対話で行える」ようにするタスク。README の「機能3: インタラクティブな旅行チャット & 編集ループ」に対応する。

既存の `TravelPlanningAgent` は旅行計画の生成フローに専念させ、常駐チャットは Issue の記載どおり **別の Chat Agent / エンドポイント** として実装する。検索・地図・天気などの Tools、LLM provider、計画検証・差分・永続化処理は共通モジュールとして再利用する。

**実装済み**

- D1 `chat_messages` テーブル（`apps/api/src/db/schema.ts:71`）
- `GET/POST /plans/:id/chat`（`apps/api/src/routes/plans.ts:220,239`）
  - POST はユーザー発話の永続化までを担う未完成状態
- レートリミットの `chat` スコープ（20回/日）— `consumeRateLimit`（`apps/api/src/lib/rate-limit.ts`）
- web 側の `getChatMessages` / `sendChatMessage`（`apps/web/lib/api.ts:149,154`）
- AI Elements 風プリミティブ（`apps/web/components/ai-elements/{conversation,message}.tsx`）
- Cloudflare Turnstile の widget / server-side verify（`components/turnstile-widget.tsx`, `lib/turnstile.ts`）

**未実装**

1. `AIChatAgent` を使う常駐チャット専用 Agent
2. 計画を修正する提案／承認ループ
3. 常駐チャットUI（PC=フローティング、モバイル=ボトムドロワー）
4. Chat Agent 接続の所有者検証
5. 修正のしおりUIへの即時反映

## 設計判断

| 論点 | 決定 | 理由 |
|---|---|---|
| Agent分割 | `TravelChatAgent extends AIChatAgent` を新設し、`/agents/travel-chat-agent/{planId}` で公開 | Issue の `useAgentChat` 要件を満たし、計画生成の状態機械と常駐会話のライフサイクルを分離する |
| クライアント | `useAgent` + `useAgentChat` | メッセージ永続化、複数タブ同期、切断後のストリーム再開を SDK に任せる |
| 再利用方針 | `buildTools`、`createLlm`、`checkPlan`、`fixPlan`、`diffPlans`、`mergeDay`、計画永続化 helper を共有 | Chat Agent を別エンドポイントにしても既存の検索・検証ロジックを重複させない |
| PCレイアウト | 右下フローティングパネル | `app/layout.tsx` の `max-w-md` フレーム構造に手を入れずに済む |
| 常駐範囲 | `/itinerary` のみ | 計画確定後に質問・修正するという Issue の趣旨に合致する |
| 計画修正の反映 | 差分プレビュー → ユーザー承認で確定 | 既存の `plan_versions` / `diffPlans` を活かし、未承認の変更を D1 へ書き込まない |
| Turnstile | 計画生成直後は生成時の検証結果から発行した chat access token を再利用し、Home の過去Plan・URL直開きは接続前に Turnstile を実施 | 生成直後に同じ人へ再チャレンジを要求せず、後日の直接アクセスは改めて人間性を確認する |
| 会話履歴 | Chat Agent SQLite をライブ会話の正本、D1 `chat_messages` をページング可能な長期アーカイブにする | DO の再起動・hibernation後も `this.messages` を復元し、既存 D1 基盤も活用する |

## アーキテクチャ

```text
[新規計画]
  POST /plans
    Turnstile 検証 → plan 作成
    → planId に限定した chatAccessToken も返す
    → sessionStorage に保存

[Home の過去計画 / URL直開き]
  TurnstileWidget
    → POST /plans/:id/chat-access
       所有者確認 + Turnstile 検証
       → planId / clientId / exp を署名した chatAccessToken

[web /itinerary]
  useAgent(travel-chat-agent, planId, query={token})
    └─ useAgentChat({ agent, resume: true })
         ├─ assistant応答・Tools結果をストリーム受信
         ├─ Agent state.pendingEdit を差分プレビューへ表示
         └─ agent.stub.applyPlanEdit(id) / rejectPlanEdit(id)
                              ↓
[Hono Agent gate]
  /agents/travel-chat-agent/:planId
    → chatAccessToken の署名・期限・planId・clientIdを検証
    → TravelChatAgent DO へ転送
                              ↓
[TravelChatAgent (AIChatAgent / planId ごとの DO)]
  onChatMessage()
    → completed plan 取得 → chatレートリミット
    → this.messages の直近履歴 + 現行planを文脈化
    → 意図判定(edit / question / other)
      ├─ question → streamText + 共有 buildTools
      ├─ edit     → 変更対象日の生成 → checkPlan → 必要時 fixPlan
      │              → 検証済み PendingPlanEdit を state へ保存・配信
      └─ other    → 短い誘導文
    → AIChatAgent SQLite へ自動永続化
    → D1 chat_messages へ idempotent にアーカイブ

  applyPlanEdit()
    → 旧版を plan_versions へ退避
    → D1 plans.plan を更新
    → state.pendingEdit を解除し appliedVersion を配信
```

計画本体は引き続き D1 `plans.plan` を単一の真実とし、**承認された修正だけ**が書き換える。チャットの再開・ライブ同期は Chat Agent SQLite、長期一覧は D1 `chat_messages` と責務を分ける。

---

## 実装ステップ

### 1. 依存追加・Chat Agent の登録

`@cloudflare/ai-chat` を `apps/api` と `apps/web` に追加する。UIライブラリは追加せず、チャット通信に必要な SDK だけを追加する。

`apps/api/wrangler.json`:

- Durable Object binding `TravelChatAgent` を追加
- 既存の `v1` は編集せず、`new_sqlite_classes: ["TravelChatAgent"]` を持つ新しい migration tag を追加
- `pnpm typegen` で binding 型を再生成

`apps/api/src/env.ts`:

- `TravelChatAgent` binding を型へ追加
- chat access token 用の `CHAT_ACCESS_SECRET` を追加
- 実値は `.dev.vars` / Wrangler secret で管理し、コミットしない

`apps/api/src/index.ts`:

- `TravelChatAgent` を Worker entry から export
- `/agents/travel-chat-agent/*` は Hono の認可ゲートを先に通し、認可済み Request だけ `TravelChatAgent` binding へ転送
- 既存 `TravelPlanningAgent` のルーティングは維持

### 2. 共有スキーマの拡張（`packages/shared/src/schemas/agent.ts` / `api-dto.ts`）

計画生成 Agent の `AgentStateSchema` へ混在させず、Chat Agent 専用 state を定義する。

```ts
export const ChatIntentSchema = z.enum(["edit", "question", "other"]);

export const PendingPlanEditSchema = z.object({
  id: z.string(),
  summary: z.string(),
  /** 未承認でも完成スキーマを必須にし、不完全な draft の適用を防ぐ。 */
  proposedPlan: TravelPlanSchema,
  diff: PlanDiffSchema,
  createdAt: z.string(),
});

export const TravelChatStateSchema = z.object({
  pendingEdit: PendingPlanEditSchema.nullable().default(null),
  /** 適用成功をUIへ通知し、D1再取得のトリガーに使う。 */
  appliedVersion: z.number().int().min(1).nullable().default(null),
});
```

`useAgentChat.onData` で扱う transient data も discriminated union として定義する。

```ts
export const ChatDataPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("activity"), label: z.string() }),
  z.object({ type: z.literal("proposal"), editId: z.string() }),
  z.object({ type: z.literal("rate_limit"), status: RateLimitStatusSchema }),
]);
```

追加 DTO:

- `CreatePlanResponseSchema`: `id` と生成時に発行する `chatAccessToken`
- `CreateChatAccessRequestSchema`: Turnstile token は既存どおり header、body は不要
- `CreateChatAccessResponseSchema`: `chatAccessToken`, `expiresAt`
- `ChatHistoryQuerySchema`: `limit`（既定20、最大50）と `before` cursor
- `ChatHistoryResponseSchema`: `messages`, `nextCursor`

### 3. Agent state のクライアント書き換え禁止

`TravelPlanningAgent` と `TravelChatAgent` の `validateStateChange` は、スキーマ検証に加えて client-originated update を拒否する。

```ts
validateStateChange(next: State, source: Connection | "server"): void {
  if (source !== "server") {
    throw new Error("client state updates are not allowed");
  }
  const result = StateSchema.safeParse(next);
  if (!result.success) throw new Error(`Invalid state: ${result.error.message}`);
}
```

これにより、ブラウザから任意の `pendingEdit` を `agent.setState()` で注入して `applyPlanEdit` へ渡す経路を閉じる。UIからの操作はすべて `@callable` または `useAgentChat` のメッセージ送信を経由する。

### 4. chat access token と Hono 認可ゲート

`apps/api/src/lib/chat-access-token.ts` を新設し、Web Crypto で以下を署名・検証する。

- `purpose: "travel-chat"`
- `planId`
- `clientId`
- `exp`

token は短期（目安2時間）・planId限定とし、URLへ生の Cookie 値や secret は載せない。

#### 新規計画からの遷移

`POST /plans` は既存どおり Turnstile → planレートリミット → plan作成の順を維持し、同じ検証済みリクエスト内で `chatAccessToken` も発行する。web は planId 単位で token を `sessionStorage` に保存する。生成完了後の `/generating` → `/itinerary` では追加の Turnstile を要求しない。

#### Home の過去計画・URL直開き

`POST /plans/:id/chat-access` を追加する。

1. 署名付き `cid` Cookie から所有者を解決し、`loadOwnedPlan` で planId を確認
2. `cf-turnstile-response` を `verifyTurnstile` で検証
3. 成功時だけ `chatAccessToken` を発行

Home の履歴カードは直接 `Link` せず、client component の `HistoryPlanLink` を介して Turnstile を完了してから token を保存・遷移する。bookmarkなど token 無しの `/itinerary` 直開きでも同じ gate を表示する。

#### Agent 接続

`useAgent` は token を query parameter として渡す。Hono の `/agents/travel-chat-agent/:planId` middleware は WebSocket upgrade / HTTP request の双方で token を検証し、payload の `planId` とURL、`clientId` と計画所有者が一致しなければ 401/403 で拒否する。

### 5. 共有チャット応答ロジック（`apps/api/src/agents/chat/`）

`TravelChatAgent` 固有の transport / persistence と、再利用可能な LLM・Tools ロジックを分離する。

| ファイル | 役割 |
|---|---|
| `prompts.ts` | 現行計画・条件・行き先・会話履歴を含むシステムプロンプトを組み立てる純関数 |
| `intent.ts` | 直近会話を含めて `edit \| question \| other` を判定。構造化出力失敗時は `"question"` |
| `context.ts` | `createClients`、目的地座標、conditions、usage counter から共有 `ToolContext` を構築 |
| `answer.ts` | `streamText` + 既存 `buildTools(ctx)` で質問へ回答し、UI message stream と activity data を返す |
| `edit.ts` | 変更対象日の生成 → `mergeDay` → `checkPlan` → 必要なら `fixPlan(..., attempts=1)` → `diffPlans` |
| `plan-persistence.ts` | 現行planのsnapshot、version更新、title/updatedAt更新を共通化し、生成確定とチャット承認から再利用 |

`answer.ts` は既存 `agents/flow/orchestrator.ts` の制御を再利用し、以下を必須にする。

- `tools: buildTools(ctx)`
- `stopWhen: [stepCountIs(CHAT_MAX_STEPS), () => shouldStopUsageLimit(ctx.usage)]`
- `maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS`
- `abortSignal: options.abortSignal`
- `fullStream` / UI message stream から tool activity を通知

`streamText` は `stopWhen` 省略時に1 stepで停止するため、tool結果をモデルへ戻して最終回答を生成するには上限付きの複数stepを明示する。

`edit.ts` は次を保証する。

- Gemini向けに `PlanItemGenSchema` / `PlanDayGenSchema` を使用
- 全計画ではなく変更対象の日だけを生成し、`mergeDay` で現行計画へ合成
- `checkPlan` が成功した `parsed`、または `fixPlan` 後の再検証済み `TravelPlan` だけを返す
- 修復後も検証に失敗した場合は提案を作らず、ユーザーへ再指定を依頼する

### 6. `TravelChatAgent` の実装（`apps/api/src/agents/travel-chat-agent.ts`）

```ts
export class TravelChatAgent extends AIChatAgent<Bindings> {
  maxPersistedMessages = 200;
  messageConcurrency = "queue";

  async onChatMessage(onFinish, options): Promise<Response>
}
```

`onChatMessage` の処理順:

1. `this.name` を planId として D1 から毎turn取得
2. row が存在し、`status === "completed"` かつ `plan !== null` であることを確認
3. 最新 user text を `SendChatMessageRequestSchema.parse({ content })` で検証
4. token認可済みの所有者 `row.clientId` で `consumeRateLimit(db, row.clientId, "chat")`
5. 最新 user message を stable message id で D1 `chat_messages` へ `onConflictDoNothing`
6. `this.messages` から直近20件を `pruneMessages` / `convertToModelMessages` でモデル文脈へ変換
7. `classifyIntent` し、question / edit / other を分岐
8. `createUIMessageStream` で text、tool activity、proposal、rate limit data を返す
9. `streamText` と custom stream の全経路で SDK から渡された `onFinish` を接続し、AIChatAgent SQLite の永続化・再開を成立させる
10. `onChatResponse` で完成した assistant text を D1 `chat_messages` へ idempotent にアーカイブ

DO の再起動や hibernationだけでは、メモリ上に無い会話文脈は生成されない。`AIChatAgent` が SQLite に永続化した `this.messages` を毎turnモデルへ渡すことで、再起動後も「それを午後に変更して」のような継続発話を解決する。

編集承認用 callable:

```ts
@callable() async applyPlanEdit(id: string): Promise<void>
@callable() async rejectPlanEdit(id: string): Promise<void>
```

- `applyPlanEdit`: `state.pendingEdit?.id === id` を確認 → 共有 `persistPlanRevision` で旧planをsnapshot → `plans.plan` と `version + 1` を更新 → `pendingEdit: null`, `appliedVersion: nextVersion` を配信
- `rejectPlanEdit`: id一致を確認して `pendingEdit: null`
- 本Issueでは既存の version 更新方式を維持し、`baseVersion` / CAS は追加しない

Streaming RPC は使用しないため、旧計画にあった `stream.close()` は削除する。応答完了は `Response` / UI message stream と `onFinish` で扱う。

### 7. HTTP ルートと D1履歴の整理（`apps/api/src/routes/plans.ts`）

- `POST /plans/:id/chat` は削除
  - 送信経路は `useAgentChat` → `TravelChatAgent` に一本化
  - `apps/web/lib/api.ts` の `sendChatMessage` も削除
- `GET /plans/:id/chat` は cursor pagination 対応へ変更
  - `limit`: 既定20、最大50
  - `before`: `createdAt` と `id` を含むopaque cursor
  - `createdAt DESC, id DESC` で取得し、レスポンスは表示用に古い順へ整列
  - `nextCursor` を返す
- D1 `chat_messages` に `(plan_id, created_at, id)` の複合indexを追加
- schema変更は `pnpm --filter @repo/api db:generate` で migration file を生成し、`drizzle-kit push` は使用しない

Chat Agent SQLite は `maxPersistedMessages = 200` で上限を設け、LLMへ渡す文脈は直近20件にさらに制限する。UIで200件より古い履歴が必要な場合だけ paginated D1 archive を読み足す。

### 8. チャットUI（`apps/web`）

Radix / vaul は追加せず、既存デザインに合わせて自前実装する。新規依存は `@cloudflare/ai-chat` のみ。

| ファイル | 内容 |
|---|---|
| `components/chat/chat-dock.tsx` | モバイルはボトムドロワー、PCは右下フローティングパネル、閉時はFAB |
| `components/chat/travel-chat.tsx` | `useAgentChat` の `messages` / `status` / `sendMessage` を AI Elements へ接続 |
| `components/chat/plan-edit-proposal.tsx` | `pendingEdit.summary` / `diff` と承認・取消ボタン |
| `components/chat/history-plan-link.tsx` | Home履歴の Turnstile gate、token保存、itinerary遷移 |
| `components/chat/chat-access-gate.tsx` | token無し・期限切れ・直URL時の Turnstile gate |
| `components/ai-elements/prompt-input.tsx` | textarea、Enter送信、Shift+Enter改行、送信中disabled、残回数 |
| `components/ai-elements/response.tsx` | 既存 Streamdown 設定を共通化 |
| `components/ai-elements/conversation.tsx` | 下端付近にいる場合だけ新着へ自動スクロール。上端でD1 archiveの前ページを取得 |
| `lib/hooks/use-travel-chat.ts` | token付き `useAgent` と `useAgentChat({ resume: true })`、`onData` のschema検証、RateLimitError相当への変換 |
| `lib/chat-access-token.ts` | planId単位の sessionStorage 読み書きと期限確認（署名検証はserverのみ） |

`chat-dock.tsx` は `role="dialog"` / `aria-modal` に加え、次を実装する。

- 開いた直後に入力欄へfocus
- Tab / Shift+Tab の focus trap
- 背景の `inert` と body scroll lock
- Esc / overlay click で閉じる
- 閉じた後に起点FABへfocusを戻す
- `100dvh` / safe-areaを使い、モバイルキーボード表示時も入力欄を隠さない

### 9. しおり画面・Homeへの結線

`apps/web/app/itinerary/page.tsx`:

- tokenの有無を先に解決し、無ければ `ChatAccessGate`
- token取得後に `useAgent({ agent: "travel-chat-agent", name: planId, query: { token } })`
- 同じ接続を `useAgentChat` と承認 callable で共有
- `state.pendingEdit` を差分プレビューへ渡す
- `state.appliedVersion` の変更を検知したら `getPlan(planId)` を再取得
- 再取得中も旧内容を表示してチラつきを防ぐ
- `ChatDock` を `AppShell` 内にマウント

`apps/web/app/page.tsx`:

- 履歴カードの直接 `Link` を `HistoryPlanLink` へ置換
- Turnstile成功 → `POST /plans/:id/chat-access` → token保存 → itinerary遷移

`apps/web/app/conditions/page.tsx` / `lib/api.ts`:

- `POST /plans` の `chatAccessToken` を planId 単位で保存
- 生成直後のしおり遷移では追加 Turnstile を表示しない

### 10. ラベル・設定・README

- `apps/web/lib/agent.ts` にチャット状態・意図・activityのラベルを追加
- `README.md` に `CHAT_ACCESS_SECRET`、Chat Agent DO migration、Home履歴での Turnstile 動作を追記
- ローカルは既存 Turnstile test site key / secret未設定時のverify bypassを踏襲
- 本番は `TURNSTILE_SECRET_KEY` と `CHAT_ACCESS_SECRET` を必須とする

---

## セキュリティ境界

- 計画生成時: Turnstile → planレートリミット → plan作成 → chat access token発行
- 過去Planへの直接アクセス時: 所有者確認 → Turnstile → chat access token発行
- Chat Agent接続時: token署名・期限・purpose・planId・clientIdをHonoで検証
- chat turn時: completed plan確認 → chatレートリミット → LLM実行
- Agent state: client-originated updateを拒否
- 計画更新: server生成かつ `TravelPlanSchema` 検証済みの pending proposalだけを承認可能

tokenを持たない第三者は Chat Agent へ接続できず、tokenを別planIdへ流用することもできない。Turnstileは毎メッセージではなく、生成時または過去Planへ直接入る際の access grant 発行時に実施する。

---

## テスト

純関数テストに加え、Hono / Chat Agent / D1 の状態遷移を統合テストする。

- `packages/shared/src/schemas/schemas.test.ts`
  - `PendingPlanEditSchema` が不完全な draft を拒否
  - `TravelChatStateSchema` / `ChatDataPartSchema` / pagination DTO
- `apps/api/src/lib/chat-access-token.test.ts`
  - 正常token、期限切れ、改竄、planId/clientId不一致
- `apps/api/src/routes/plans.test.ts`
  - 生成時token発行
  - 過去Plan accessの所有者確認
  - Turnstile失敗/成功
  - chat履歴cursor pagination
- `apps/api/src/agents/chat/intent.test.ts`
  - 履歴を含む指示語の判定、不正構造化出力時のfallback
- `apps/api/src/agents/chat/edit.test.ts`
  - `checkPlan` / 修復成功時だけproposalを返す
  - 修復後も不正ならpending editを作らない
- `apps/api/src/agents/chat/answer.test.ts`
  - `stopWhen`、使用量上限、`maxOutputTokens`、abort signal
- `apps/api/src/agents/travel-chat-agent.test.ts`
  - draft / plan null拒否
  - chatレートリミット
  - client-originated state update拒否
  - assistant完了・D1 archive
  - DO再生成後も persisted messages をモデル文脈へ渡す
  - apply / reject と D1 version / state更新

web は既存どおり実機Browser確認を必須にし、accessibility操作も検証項目へ含める。

---

## 検証手順

1. `pnpm check`（lint / format:check / typecheck / test / build）
2. D1 migrationをlocalへ適用し、`pnpm dev` で web(3000) / api(8787) を起動
3. 新規生成フロー
   - `/` → 行き先 → 条件 → Turnstile → 生成 → `/itinerary`
   - itinerary遷移時に2回目のTurnstileが出ない
4. Home履歴フロー
   - Homeの過去Planを押すとTurnstile gateが出る
   - 検証成功後だけitinerary / Chat Agentへ接続できる
   - 別clientId・期限切れ・別planId tokenは拒否される
5. チャット
   - 「2日目の昼食はどこ？」へTools利用後の回答がストリーム表示される
   - 続けて「それを午後にして」が直前会話を参照して解釈される
   - 接続を途中で切って再接続してもストリームと履歴が復元される
   - 21回目が拒否され、残回数と `resetAt` が表示される
6. 計画修正
   - 「2日目を温泉中心に変えて」→ 差分preview
   - 承認でD1 plan・version・しおりが更新される
   - 取消ではD1 planが変わらない
   - 不完全な生成結果はproposalとして表示されない
7. UI / accessibility
   - 375px: keyboard、safe-area、focus trap、背景scroll lock、focus復帰
   - 1280px: 右下panelがしおりフレームと重ならない
8. `GET /plans/:id/chat?limit=20` の `nextCursor` で重複・欠落なく履歴を追加取得できる
9. `GET /plans/:id/versions` に承認時snapshotが増える
10. `pnpm preview:full` で OpenNext build後も同じフローを確認

---

## ブランチ / PR

- `dev` から `feat/issue-20-persistent-chat` を切る
- コミットメッセージ・PRタイトル・本文は日本語で記述
- PRのベースは必ず `dev`、`main` には触れない
- PR checklistをすべて埋める
- Co-Author に AI アシスタントを追加しない
