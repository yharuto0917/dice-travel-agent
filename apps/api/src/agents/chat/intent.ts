import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { type ChatIntent, ChatIntentSchema, type TravelPlan } from "@repo/shared";
import { generateObject, type ModelMessage } from "ai";
import { z } from "zod";
import type { Bindings } from "../../env";
import { createLlm, SUBAGENT_MODEL_ID } from "../llm/provider";
import { intentSystemPrompt } from "./prompts";

/** 意図判定の結果。edit の場合のみ対象の日番号を持つ。 */
export interface ChatClassification {
  intent: ChatIntent;
  /** 修正対象の日番号（昇順・重複なし）。全体的な修正や edit 以外では空。 */
  dayNumbers: number[];
}

/** 構造化出力のスキーマ。日番号は後段で計画の日数に丸めるためここでは緩く受ける。 */
const ClassificationSchema = z.object({
  intent: ChatIntentSchema,
  dayNumbers: z.array(z.number()).default([]),
});

/** 意図判定の出力上限。分類だけなので小さく抑える。 */
const INTENT_MAX_OUTPUT_TOKENS = 256;

/** 直前の会話をどこまで判定材料にするか。指示語の解決に足りる範囲に絞る。 */
const INTENT_HISTORY_MESSAGES = 6;

/**
 * 構造化出力を扱いやすい形へ正規化する純関数。
 *
 * - 日番号を整数化し、計画の日数（1..dayCount）の範囲外を捨てる
 * - 重複を除き昇順に整える
 * - edit 以外では日番号を持たせない
 *
 * LLM は範囲外の日番号（0 や存在しない 5 日目）をしばしば返す。これをそのまま
 * 編集ループへ渡すと存在しない日を作ってしまうため、ここで確実に落とす。
 */
export function normalizeClassification(
  raw: { intent: ChatIntent; dayNumbers?: number[] },
  dayCount: number,
): ChatClassification {
  if (raw.intent !== "edit") return { intent: raw.intent, dayNumbers: [] };

  const dayNumbers = [...new Set((raw.dayNumbers ?? []).map((n) => Math.trunc(n)))]
    .filter((n) => n >= 1 && n <= dayCount)
    .sort((a, b) => a - b);

  return { intent: "edit", dayNumbers };
}

/**
 * 判定に使う直近履歴を切り出す純関数。
 *
 * 単純な `slice(-n)` だと、ツール呼び出しの途中（assistant の functionCall と、その結果を
 * 返す tool メッセージの間）で履歴が切れることがある。この形を Gemini へ渡すと
 * 「function call turn comes immediately after a user turn or after a function response turn」
 * で 400 になり、意図判定が丸ごと失敗する。フォールバックは "question" なので、
 * **修正指示がすべて質問として扱われる**（提案が出ない）という形で表に出る。
 *
 * そこで窓の先頭が必ず user 発話になるまで捨てる。窓内に user 発話が無い場合は、
 * 判定対象そのものである最新の user 発話だけを渡す。
 */
export function recentHistory(messages: ModelMessage[], limit: number): ModelMessage[] {
  const window = messages.slice(-limit);
  const start = window.findIndex((m) => m.role === "user");
  if (start >= 0) return window.slice(start);

  // findLast は tsconfig の lib（ES2022）に無いので、後ろから素直に探す。
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "user") return [message];
  }
  return [];
}

/**
 * 発話の意図を判定する（#20）。
 *
 * 判定は分類だけの軽い処理なので、Supervisor ではなく軽量モデルで回す。
 * 構造化出力が壊れた・モデル呼び出しが失敗した場合は `"question"` にフォールバックする。
 * 誤って `"edit"` に倒すと勝手な修正提案が出てしまうため、安全側は常に質問応答。
 */
export async function classifyIntent(
  env: Bindings,
  plan: TravelPlan,
  messages: ModelMessage[],
): Promise<ChatClassification> {
  try {
    const { object } = await generateObject({
      model: createLlm(env, SUBAGENT_MODEL_ID),
      schema: ClassificationSchema,
      temperature: 0,
      maxOutputTokens: INTENT_MAX_OUTPUT_TOKENS,
      maxRetries: 1,
      providerOptions: {
        google: {
          thinkingConfig: { thinkingLevel: "low", includeThoughts: false },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
      system: intentSystemPrompt(plan),
      messages: recentHistory(messages, INTENT_HISTORY_MESSAGES),
    });
    return normalizeClassification(object, plan.days.length);
  } catch {
    return { intent: "question", dayNumbers: [] };
  }
}
