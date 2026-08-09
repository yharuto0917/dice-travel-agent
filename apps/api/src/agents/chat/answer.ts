import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import type { TravelPlan } from "@repo/shared";
import {
  type ModelMessage,
  type StreamTextOnFinishCallback,
  stepCountIs,
  streamText,
  type ToolSet,
} from "ai";
import type { Bindings } from "../../env";
import { shouldStopUsageLimit } from "../flow/judgement";
import { createLlm, SUPERVISOR_MODEL_ID } from "../llm/provider";
import { buildTools } from "../tools";
import type { ToolContext } from "../tools/context";
import { answerSystemPrompt } from "./prompts";

/**
 * 1ターンで許すステップ数の上限（#20）。
 * 「検索 → 結果を踏まえて回答」の往復を賄いつつ、会話でツールループが暴走しないよう
 * 計画生成（MAX_STEPS=8）より短く取る。
 */
export const CHAT_MAX_STEPS = 5;

/** 1回の回答の出力上限。チャット吹き出しに収まる長さに抑える。 */
export const CHAT_MAX_OUTPUT_TOKENS = 2048;

/** ツール名 → 実行中に表示する日本語ラベル。 */
const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  touristSpotSearch: "観光スポットを調べています",
  hotelSearch: "宿を調べています",
  restaurantSearch: "飲食店を調べています",
  transportationSearch: "移動を調べています",
  weather: "天気を調べています",
  imageSearch: "画像を探しています",
  googleMaps: "地図で確認しています",
  calculate: "計算しています",
};

/** ツール名から表示ラベルを引く（未知のツールも表示できるようフォールバックする）。 */
export function toolActivityLabel(toolName: string): string {
  return TOOL_ACTIVITY_LABELS[toolName] ?? `${toolName} を実行しています`;
}

export interface ChatAnswerParams {
  plan: TravelPlan;
  messages: ModelMessage[];
  /** 中断シグナル。AIChatAgent から渡される `options.abortSignal` をそのまま繋ぐ。 */
  abortSignal?: AbortSignal;
  /** AIChatAgent から渡される完了フック。必ず接続する。 */
  onFinish?: StreamTextOnFinishCallback<ToolSet>;
  /** ツール実行の開始を UI へ通知する（transient data として流す）。 */
  onActivity?: (label: string) => void;
}

/**
 * 質問応答（QAループ, #20）。
 *
 * 確定済みの計画を文脈に、必要なら検索ツールを使って答える。AI SDK v6 は `stopWhen`
 * 省略時に 1 ステップで停止しツール結果がモデルへ戻らないため、上限付きの複数ステップを
 * 明示する（これが無いと「検索はしたが答えない」応答になる）。
 *
 * 戻り値は `streamText` の結果そのもの。呼び出し側（TravelChatAgent）が
 * `toUIMessageStream()` を UI ストリームへ merge する。
 */
export function streamChatAnswer(env: Bindings, ctx: ToolContext, params: ChatAnswerParams) {
  const { plan, messages, abortSignal, onFinish, onActivity } = params;
  const tools = buildTools(ctx);

  return streamText({
    model: createLlm(env, SUPERVISOR_MODEL_ID),
    system: answerSystemPrompt(plan),
    messages,
    tools,
    stopWhen: [stepCountIs(CHAT_MAX_STEPS), () => shouldStopUsageLimit(ctx.usage)],
    maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
    abortSignal,
    // AIChatAgent は onFinish を汎用の ToolSet で型付けするが、streamText は具体的な
    // ツール集合で型付けする。コールバック引数は不変（invariant）なので、同じ完了
    // イベントでも型が噛み合わない。橋渡しの薄いアダプタでこの境界だけ吸収する。
    onFinish: onFinish
      ? (event) => onFinish(event as unknown as Parameters<StreamTextOnFinishCallback<ToolSet>>[0])
      : undefined,
    providerOptions: {
      google: {
        // 会話は即応性が要るので思考の深さは控えめに保つ。ただし思考テキスト自体は受け取り、
        // 何を考えて答えたのかを UI 側で折りたたみ表示する（reasoning パートとして流れる）。
        thinkingConfig: { thinkingLevel: "medium", includeThoughts: true },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    onChunk: ({ chunk }) => {
      if (chunk.type === "tool-call") onActivity?.(toolActivityLabel(chunk.toolName));
    },
  });
}
