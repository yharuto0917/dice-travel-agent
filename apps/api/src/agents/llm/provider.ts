import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Bindings } from "../../env";

export const GEMINI_MODEL_ID = "gemini-3.5-flash";

export function createLlm(env: Bindings) {
  const baseURL = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_NAME}/google-ai-studio/v1beta`;

  const google = createGoogleGenerativeAI({
    apiKey: env.GEMINI_API_KEY || "",
    baseURL,
  });

  return google(GEMINI_MODEL_ID);
}

export function hasLlm(env: Bindings): boolean {
  return Boolean(env.GEMINI_API_KEY);
}
