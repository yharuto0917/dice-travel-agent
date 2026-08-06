import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  type ChatDataPart,
  SendChatMessageRequestSchema,
  type TravelChatState,
  TravelChatStateSchema,
  type TravelPlan,
} from "@repo/shared";
import { type Connection, callable } from "agents";
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
import { chatMessages, type PlanRow, plans } from "../db/schema";
import type { Bindings } from "../env";
import { consumeRateLimit } from "../lib/rate-limit";
import { streamChatAnswer } from "./chat/answer";
import { createChatToolContext } from "./chat/context";
import { createPlanEdit } from "./chat/edit";
import { classifyIntent } from "./chat/intent";
import { persistPlanRevision } from "./chat/plan-persistence";
import { OFF_TOPIC_REPLY } from "./chat/prompts";
import type { ToolContext } from "./tools/context";

/**
 * DO SQLite に保持する会話の上限。これより古い履歴は D1 `chat_messages` の
 * アーカイブから読み足す。
 */
const MAX_PERSISTED_MESSAGES = 200;

/** LLM へ渡す会話の直近件数。永続件数とは別に、文脈コストを抑えるため更に絞る。 */
const MODEL_CONTEXT_MESSAGES = 20;

/** 対象日を特定できなかった修正指示への返答。 */
const NO_TARGET_REPLY =
  "どの日を変更するか教えていただけますか。「2日目を温泉中心に変えて」のように、日にちを添えてお伝えください。";

/** 修正案の生成・検証に失敗したときの返答。 */
const EDIT_FAILED_REPLY =
  "うまく修正案を作れませんでした。変更したい内容をもう少し具体的に指定していただけますか。";

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

  /** 送信が重なっても取りこぼさず順に処理する（会話の因果を保つ）。 */
  messageConcurrency = "queue" as const;

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

  /** 直近の user メッセージの本文を取り出す。 */
  private latestUserText(): string | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message?.role !== "user") continue;
      const text = message.parts
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();
      return text.length > 0 ? text : null;
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
    const db = getDb(this.env);
    await db
      .insert(chatMessages)
      .values({ id, planId: this.planId, role, content })
      .onConflictDoNothing();
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
    const abortSignal = options?.abortSignal;

    const row = await this.loadPlanRow();
    // 計画が無い／未完成の間はチャットを動かさない。下書きを文脈に会話しても
    // 修正対象が定まらず、生成中の Agent と D1 の書き込みが競合する。
    if (row?.status !== "completed" || !row.plan) {
      return this.respondWithText(PLAN_NOT_READY_REPLY);
    }

    const rawText = this.latestUserText();
    const parsed = SendChatMessageRequestSchema.safeParse({ content: rawText ?? "" });
    if (!parsed.success) {
      return this.respondWithText("メッセージを入力してください（2000文字以内）。");
    }
    const content = parsed.data.content;

    // レートリミット（#17: チャット 20回/日）。WebSocket 経由で Cookie ミドルウェアを
    // 通らないため、計画の所有者 clientId を D1 の行から引いてカウントする。
    const limit = await consumeRateLimit(getDb(this.env), row.clientId, "chat");

    const userMessage = this.messages.at(-1);
    if (userMessage?.role === "user") {
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

    const classification = await classifyIntent(this.env, plan, modelMessages);

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        this.writeData(writer, { type: "data-rate-limit", data: limit });

        if (classification.intent === "other") {
          this.writeText(writer, OFF_TOPIC_REPLY);
          return;
        }

        // 質問応答・修正案の双方が検索ツールを使うので、ターンの入口で1つ作って共有する。
        const ctx = createChatToolContext(this.env, row, plan);

        if (classification.intent === "edit") {
          await this.runEdit(writer, ctx, plan, content, classification.dayNumbers);
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
      // 下調べのツール実行は待ち時間が長いので、何を調べているかを逐次表示する。
      onActivity: (label) => this.writeData(writer, { type: "data-activity", data: { label } }),
      // 修正案づくりはメッセージを組み立てずに進むため、思考の載せ先が無い。
      // transient data として流し、UI 側で折りたたみ表示する。
      onReasoning: (text) => this.writeData(writer, { type: "data-reasoning", data: { text } }),
    });
    if (result.status !== "ok") {
      this.writeText(writer, result.reason === "no_target" ? NO_TARGET_REPLY : EDIT_FAILED_REPLY);
      return;
    }

    // 提案は state 経由で全接続へ配信する（しおり側の差分プレビューも同じ state を見る）。
    this.setState({ ...this.state, pendingEdit: result.edit });
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
    const pending = this.state.pendingEdit;
    // 二重クリックや古いタブからの承認で、別の提案が適用されないよう id を突き合わせる。
    if (!pending || pending.id !== id) return;

    const row = await this.loadPlanRow();
    if (!row) return;

    const version = await persistPlanRevision(this.env, {
      plan: pending.proposedPlan,
      row,
      status: "completed",
      label: `チャット修正前(v${row.version})`,
    });

    this.setState({ ...this.state, pendingEdit: null, appliedVersion: version });
  }

  /** 承認待ちの修正を破棄する（計画は変更しない）。 */
  @callable()
  async rejectPlanEdit(id: string): Promise<void> {
    const pending = this.state.pendingEdit;
    if (!pending || pending.id !== id) return;
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
