import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  type ChatDataPart,
  type PendingPlanEdit,
  SendChatMessageRequestSchema,
  type TravelChatState,
  TravelChatStateSchema,
  type TravelPlan,
} from "@repo/shared";
import { type Connection, type ConnectionContext, callable, getCurrentAgent } from "agents";
import type { ChatResponseResult } from "agents/chat";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  pruneMessages,
  type StreamTextOnFinishCallback,
  type ToolSet,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { type PlanRow, plans } from "../db/schema";
import type { Bindings } from "../env";
import { CHAT_ACCESS_EXPIRES_HEADER, isChatAccessExpired } from "../lib/chat-access-token";
import { consumeRateLimit } from "../lib/rate-limit";
import { streamChatAnswer } from "./chat/answer";
import { CHAT_MESSAGE_CONCURRENCY } from "./chat/concurrency";
import { createChatToolContext } from "./chat/context";
import { createPlanEdit } from "./chat/edit";
import { classifyIntent } from "./chat/intent";
import { PlanRevisionConflictError, persistPlanRevision } from "./chat/plan-persistence";
import { OFF_TOPIC_REPLY } from "./chat/prompts";
import type { ToolContext } from "./tools/context";
import { deleteGeneratedImageKeys } from "./tools/generate-image";

/**
 * DO SQLite に保持する会話の上限。これより古い履歴は D1 `chat_messages` の
 * アーカイブから読み足す。
 */
const MAX_PERSISTED_MESSAGES = 200;

/** LLM へ渡す会話の直近件数。永続件数とは別に、文脈コストを抑えるため更に絞る。 */
const MODEL_CONTEXT_MESSAGES = 20;

/** access token 失効・認可不備で閉じるアプリケーション定義 WebSocket code。 */
const CHAT_ACCESS_CLOSE_CODE = 4001;

/** Hibernation をまたいで保持する接続単位の認可状態。 */
interface ChatConnectionState {
  /** UNIX ミリ秒。 */
  accessExpiresAt: number;
}

/** 対象日を特定できなかった修正指示への返答。 */
const NO_TARGET_REPLY =
  "どの日を変更するか教えていただけますか。「2日目を温泉中心に変えて」のように、日にちを添えてお伝えください。";

/** 修正案の生成・検証に失敗したときの返答。 */
const EDIT_FAILED_REPLY =
  "うまく修正案を作れませんでした。変更したい内容をもう少し具体的に指定していただけますか。";

/** 1回の編集日数上限を超えたときの返答。 */
const TOO_MANY_TARGETS_REPLY =
  "一度に変更できるのは3日分までです。対象を3日以内に分けてお伝えください。";

/** 計画がまだ完成していないときの返答。 */
const PLAN_NOT_READY_REPLY =
  "まだ計画の作成が完了していません。しおりができあがってからご相談ください。";

/**
 * 常駐チャット Agent（#20）。
 *
 * 計画生成の状態機械（{@link import("./travel-planning-agent").TravelPlanningAgent}）とは
 * 別の Durable Object にする。生成は「一度きりの長いワークフロー」、常駐チャットは
 * 「何度でも来る短い会話」でライフサイクルが噛み合わないため、DO を分けて
 * 会話の永続化・再開は AIChatAgent に任せる。planId ごとに1インスタンス。
 *
 * 接続認可（chat access token の検証）は Worker エントリの Hono ゲートで済ませている。
 */
export class TravelChatAgent extends AIChatAgent<Bindings, TravelChatState> {
  initialState: TravelChatState = TravelChatStateSchema.parse({});

  maxPersistedMessages = MAX_PERSISTED_MESSAGES;

  /**
   * 応答中の重複 submit は永続化前に拒否する。
   *
   * queue にすると、先のターンが始まる前に後続 user message まで `this.messages` へ入り、
   * 先のターンが後続発話を処理してしまう。通常 UI でも入力をロックするが、直接接続する
   * クライアントからの重複送信に対しても会話の因果を壊さないようサーバ側で防ぐ。
   */
  messageConcurrency: typeof CHAT_MESSAGE_CONCURRENCY = CHAT_MESSAGE_CONCURRENCY;

  /**
   * state 更新の検証。スキーマ検証に加えてクライアント起点の更新を拒否する。
   *
   * これが無いと、ブラウザから `agent.setState({ pendingEdit: 任意の計画 })` を注入し、
   * そのまま `applyPlanEdit` で D1 の計画を差し替えられてしまう。修正提案は必ず
   * サーバ側の生成・検証を通ったものだけにする。
   */
  validateStateChange(next: TravelChatState, source: Connection | "server"): void {
    if (source !== "server") {
      throw new Error("client state updates are not allowed");
    }
    const result = TravelChatStateSchema.safeParse(next);
    if (!result.success) {
      throw new Error(`Invalid TravelChatState: ${result.error.message}`);
    }
  }

  /** この Agent が担当する計画ID（DO 名 = planId）。 */
  private get planId(): string {
    return this.name;
  }

  /**
   * 認可ゲートが検証した失効時刻を接続 state に保存し、永続 schedule で期限時に閉じる。
   * connection.state と schedule はどちらも DO の Hibernation をまたいで残る。
   */
  async onConnect(connection: Connection<ChatConnectionState>, ctx: ConnectionContext) {
    const expSec = Number(ctx.request.headers.get(CHAT_ACCESS_EXPIRES_HEADER));
    const expiresAt = expSec * 1000;
    if (isChatAccessExpired(expiresAt)) {
      connection.close(CHAT_ACCESS_CLOSE_CODE, "Chat access expired");
      return;
    }

    connection.setState({ accessExpiresAt: expiresAt });
    try {
      await this.schedule(
        new Date(expiresAt),
        "expireChatConnection",
        { connectionId: connection.id, expiresAt },
        { idempotent: true },
      );
    } catch (error) {
      connection.close(CHAT_ACCESS_CLOSE_CODE, "Chat access scheduling failed");
      throw error;
    }
  }

  /** schedule された期限で、同じ認可期限を持つ接続だけを閉じる。 */
  async expireChatConnection(payload: { connectionId: string; expiresAt: number }): Promise<void> {
    const connection = this.getConnection<ChatConnectionState>(payload.connectionId);
    if (!connection || connection.state?.accessExpiresAt !== payload.expiresAt) return;

    // Date 指定 schedule は期限時刻以降に実行される。callback 内で再登録すると、実行中の
    // idempotent schedule 自身へ吸収される恐れがあるため、ここでは必ず一度で閉じる。
    connection.close(CHAT_ACCESS_CLOSE_CODE, "Chat access expired");
  }

  /** message / callable の入口でも期限を確認し、schedule 発火との短い競合窓を閉じる。 */
  private assertChatAccessActive(): void {
    const { connection } = getCurrentAgent<TravelChatAgent>();
    // onChatResponse などサーバ起点のライフサイクルには connection が無い。
    if (!connection) return;
    const expiresAt = (connection.state as ChatConnectionState | null)?.accessExpiresAt;
    if (typeof expiresAt === "number" && !isChatAccessExpired(expiresAt)) return;

    connection.close(CHAT_ACCESS_CLOSE_CODE, "Chat access expired");
    throw new Error("chat access expired");
  }

  /**
   * 計画行を D1 から読む。
   *
   * 毎ターン読み直す（キャッシュしない）。チャットの修正承認・バージョン復元で
   * 計画は会話の途中でも変わるため、古い計画を文脈に会話を続けないようにする。
   */
  private async loadPlanRow(): Promise<PlanRow | null> {
    const db = getDb(this.env);
    const [row] = await db.select().from(plans).where(eq(plans.id, this.planId));
    return row ?? null;
  }

  /** 直近の user メッセージを取り出す。本文と archive ID を同じ発話へ固定する。 */
  private latestUserMessage(): UIMessage | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message?.role !== "user") continue;
      return message;
    }
    return null;
  }

  /**
   * メッセージを D1 のアーカイブへ書き込む（#20）。
   *
   * DO SQLite は直近 {@link MAX_PERSISTED_MESSAGES} 件しか持たないため、長期の履歴は D1 側に残す。
   * UIMessage の id をそのまま主キーに使い、再送・再開で同じメッセージが二重に
   * 届いても増えないようにする（idempotent）。
   */
  private async archiveMessage(
    id: string,
    role: "user" | "assistant",
    content: string,
  ): Promise<void> {
    if (!content.trim()) return;
    const now = new Date().toISOString();
    // D1 の既定 CURRENT_TIMESTAMP（秒精度）は使わない。同じ plan の直前時刻以上なら
    // 1ms進めることで、定型応答のようにuser/assistantが同一ミリ秒でも保存順を維持する。
    // 既存の秒精度行も julianday で読めるため、migrationで履歴を直接backfillする必要がない。
    await this.env.DB.prepare(
      `INSERT INTO chat_messages (id, plan_id, role, content, created_at)
       SELECT ?, ?, ?, ?,
         CASE
           WHEN COALESCE(MAX(julianday(created_at)), 0) >= julianday(?)
             THEN strftime('%Y-%m-%dT%H:%M:%fZ', MAX(julianday(created_at)) + 1.0 / 86400000)
           ELSE ?
         END
       FROM chat_messages
       WHERE plan_id = ?
       ON CONFLICT(id) DO NOTHING`,
    )
      .bind(id, this.planId, role, content, now, now, this.planId)
      .run();
  }

  /** 却下・上書きする提案のためだけに生成した R2 object を削除する。 */
  private async deletePendingEditImages(pending: PendingPlanEdit | null): Promise<void> {
    if (!pending) return;
    await deleteGeneratedImageKeys(this.env.BUCKET, pending.generatedImageKeys ?? []);
  }

  /** 単発のテキスト応答をストリームへ書き出す（LLM を経由しない定型返答用）。 */
  private writeText(writer: UIMessageStreamWriter, text: string): void {
    const id = crypto.randomUUID();
    writer.write({ type: "text-start", id });
    writer.write({ type: "text-delta", id, delta: text });
    writer.write({ type: "text-end", id });
  }

  /** transient data を書き出す（メッセージ本文としては永続化されない）。 */
  private writeData(writer: UIMessageStreamWriter, part: ChatDataPart): void {
    writer.write({ ...part, transient: true });
  }

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Response | undefined> {
    this.assertChatAccessActive();
    const abortSignal = options?.abortSignal;

    const row = await this.loadPlanRow();
    // 計画が無い／未完成の間はチャットを動かさない。下書きを文脈に会話しても
    // 修正対象が定まらず、生成中の Agent と D1 の書き込みが競合する。
    if (row?.status !== "completed" || !row.plan) {
      return this.respondWithText(PLAN_NOT_READY_REPLY);
    }

    const userMessage = this.latestUserMessage();
    const rawText = userMessage ? textOf(userMessage).trim() : null;
    const parsed = SendChatMessageRequestSchema.safeParse({ content: rawText ?? "" });
    if (!parsed.success) {
      return this.respondWithText("メッセージを入力してください（2000文字以内）。");
    }
    const content = parsed.data.content;

    // レートリミット（#17: チャット 20回/日）。WebSocket 経由で Cookie ミドルウェアを
    // 通らないため、計画の所有者 clientId を D1 の行から引いてカウントする。
    const limit = await consumeRateLimit(getDb(this.env), row.clientId, "chat");

    if (userMessage) {
      await this.archiveMessage(userMessage.id, "user", content);
    }

    if (!limit.allowed) {
      return this.respondWithText(
        `本日のチャット回数の上限（${limit.limit}回）に達しました。日付が変わるとまたご利用いただけます。`,
        { type: "data-rate-limit", data: limit },
      );
    }

    const plan = row.plan as TravelPlan;
    const modelMessages = pruneMessages({
      messages: await convertToModelMessages(this.messages.slice(-MODEL_CONTEXT_MESSAGES)),
      reasoning: "all",
      emptyMessages: "remove",
    });

    const classification = await classifyIntent(this.env, plan, modelMessages, abortSignal);

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        this.writeData(writer, { type: "data-rate-limit", data: limit });

        if (classification.intent === "other") {
          this.writeText(writer, OFF_TOPIC_REPLY);
          return;
        }

        // 質問応答・修正案の双方が検索ツールを使うので、ターンの入口で1つ作って共有する。
        const ctx = createChatToolContext(this.env, row, plan, abortSignal);

        if (classification.intent === "edit") {
          await this.runEdit(writer, ctx, plan, content, classification.dayNumbers, abortSignal);
          return;
        }

        const result = streamChatAnswer(this.env, ctx, {
          plan,
          messages: modelMessages,
          abortSignal,
          onFinish,
          onActivity: (label) => this.writeData(writer, { type: "data-activity", data: { label } }),
        });
        writer.merge(result.toUIMessageStream());
      },
    });

    return createUIMessageStreamResponse({ stream });
  }

  /**
   * 修正案を作って state へ載せ、結果を会話へ返す（編集ループ, #20）。
   * この時点では D1 を書き換えない。承認（`applyPlanEdit`）で初めて確定する。
   */
  private async runEdit(
    writer: UIMessageStreamWriter,
    ctx: ToolContext,
    plan: TravelPlan,
    instruction: string,
    dayNumbers: number[],
    abortSignal?: AbortSignal,
  ): Promise<void> {
    if (dayNumbers.length === 0) {
      this.writeText(writer, NO_TARGET_REPLY);
      return;
    }

    this.writeData(writer, {
      type: "data-activity",
      data: { label: `${dayNumbers.map((n) => `${n}日目`).join("・")}の修正案を作っています` },
    });

    const result = await createPlanEdit(this.env, ctx, {
      plan,
      instruction,
      dayNumbers,
      abortSignal,
      // 下調べのツール実行は待ち時間が長いので、何を調べているかを逐次表示する。
      onActivity: (label) => this.writeData(writer, { type: "data-activity", data: { label } }),
      // 修正案づくりはメッセージを組み立てずに進むため、思考の載せ先が無い。
      // transient data として流し、UI 側で折りたたみ表示する。
      onReasoning: (text) => this.writeData(writer, { type: "data-reasoning", data: { text } }),
    });
    if (result.status !== "ok") {
      const reply =
        result.reason === "no_target"
          ? NO_TARGET_REPLY
          : result.reason === "too_many_targets"
            ? TOO_MANY_TARGETS_REPLY
            : EDIT_FAILED_REPLY;
      this.writeText(writer, reply);
      return;
    }

    // 提案は state 経由で全接続へ配信する（しおり側の差分プレビューも同じ state を見る）。
    const nextState = TravelChatStateSchema.parse({ ...this.state, pendingEdit: result.edit });
    try {
      await this.deletePendingEditImages(this.state.pendingEdit);
      this.setState(nextState);
    } catch (error) {
      // state に載らなかった新提案の画像も孤立させない。旧提案は state に残る。
      await this.deletePendingEditImages(result.edit);
      throw error;
    }
    this.writeData(writer, { type: "data-proposal", data: { editId: result.edit.id } });
    this.writeText(
      writer,
      `${result.edit.summary}\n\n変更内容を下に表示しました。よろしければ「反映する」を押してください。`,
    );
  }

  /** LLM を通さない定型応答を UI message stream として返す。 */
  private respondWithText(text: string, data?: ChatDataPart): Response {
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        if (data) this.writeData(writer, data);
        this.writeText(writer, text);
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  /**
   * 完了した assistant 発話を D1 アーカイブへ書き込む。
   * ターンのロック解放後に呼ばれるので、ここでの D1 書き込みは応答を遅らせない。
   */
  protected async onChatResponse(result: ChatResponseResult): Promise<void> {
    if (result.status !== "completed") return;
    const text = textOf(result.message);
    await this.archiveMessage(result.message.id, "assistant", text);
  }

  /**
   * 承認待ちの修正を計画へ適用する（#20）。
   *
   * 旧版を `plan_versions` へ退避してから現行計画を差し替えるので、
   * 既存の `restore` / `diff` でそのまま巻き戻せる。
   */
  @callable()
  async applyPlanEdit(id: string): Promise<void> {
    this.assertChatAccessActive();
    const pending = this.state.pendingEdit;
    // 二重クリックや古いタブからの承認で、別の提案が適用されないよう id を突き合わせる。
    if (!pending || pending.id !== id) return;

    const row = await this.loadPlanRow();
    if (!row) return;

    let version: number;
    try {
      version = await persistPlanRevision(this.env, {
        plan: pending.proposedPlan,
        row,
        status: "completed",
        label: `チャット修正前(v${row.version})`,
      });
    } catch (error) {
      if (error instanceof PlanRevisionConflictError && this.state.pendingEdit?.id === id) {
        // 別タブや restore が先に版を進めた提案は、再クリックで新しい計画を古い案へ
        // 上書きできないよう破棄する。未採用画像も同時に後始末する。
        await this.deletePendingEditImages(pending);
        this.setState({ ...this.state, pendingEdit: null });
      }
      throw error;
    }

    this.setState({ ...this.state, pendingEdit: null, appliedVersion: version });
  }

  /** 承認待ちの修正を破棄する（計画は変更しない）。 */
  @callable()
  async rejectPlanEdit(id: string): Promise<void> {
    this.assertChatAccessActive();
    const pending = this.state.pendingEdit;
    if (!pending || pending.id !== id) return;
    await this.deletePendingEditImages(pending);
    this.setState({ ...this.state, pendingEdit: null });
  }
}

/** UIMessage のテキストパートを連結する。 */
function textOf(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}
