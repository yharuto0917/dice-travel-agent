import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Bindings } from "../../env";

/** Supervisor（統括の day-planner）用モデル。ツール統括・最終構造化の品質を担う。 */
export const SUPERVISOR_MODEL_ID = "gemini-3.5-flash";
/** サブエージェント（research/enhancement/factcheck/summarize）用の軽量モデル。 */
export const SUBAGENT_MODEL_ID = "gemini-3.1-flash-lite";

/** 既定モデル（明示指定が無い場合は Supervisor 用）。 */
export const GEMINI_MODEL_ID = SUPERVISOR_MODEL_ID;

/**
 * Gemini モデルを生成する。modelId で Supervisor/サブエージェントのモデルを切り替える。
 * 認証は全モデル共通（パススルー + 認証必須 Gateway）。
 */
export function createLlm(env: Bindings, modelId: string = GEMINI_MODEL_ID) {
  const baseURL = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_NAME}/google-ai-studio/v1beta`;

  const google = createGoogleGenerativeAI({
    // パススルー方式: 自分の Google AI Studio キーで認証・課金する（x-goog-api-key）。
    apiKey: env.GEMINI_API_KEY ?? "",
    baseURL,
    headers: {
      // AI Gateway は認証必須設定のため、CF API トークンを cf-aig-authorization で併送する
      // （これが無いと Gateway 自身が 401 を返し、Gemini まで到達しない）。
      "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN ?? ""}`,
    },
  });

  return google(modelId);
}

/**
 * AI 経路を有効化できるか。パススルー方式ではモデル認証鍵 GEMINI_API_KEY の有無で判定する。
 * 認証必須 Gateway を通すには別途 AI_GATEWAY_TOKEN も必要（未設定だと呼び出しは 401 になる）。
 */
export function hasLlm(env: Bindings): boolean {
  return Boolean(env.GEMINI_API_KEY);
}
