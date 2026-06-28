import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { google } from "@ai-sdk/google";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { Bindings } from "../../env";
import { SUBAGENT_MAX_STEPS } from "../flow/judgement";
import { createLlm, SUBAGENT_MODEL_ID } from "../llm/provider";
import type { ToolContext } from "../tools/context";
import { buildImageSearch } from "../tools/image-search";

export function buildEnhancementSubagent(env: Bindings, ctx: ToolContext) {
  return tool({
    description: "Enhance descriptions, titles, and details of plan items.",
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            id: z.string().optional(),
            title: z.string(),
            description: z.string().optional(),
          }),
        )
        .describe("List of plan items to enhance"),
    }),
    execute: async ({ items }) => {
      ctx.usage.subagent();

      const { text } = await generateText({
        model: createLlm(env, SUBAGENT_MODEL_ID),
        system:
          "You are an enhancement subagent. Improve the titles and descriptions of the given travel items to be more attractive and informative, while staying factual — do not invent attributes, prices, or claims that may not be true. Keep titles short; keep descriptions concise (1–2 sentences). Preserve each item's id. You may search for images if helpful. Output the enhanced items in a clear structured format. 思考（reasoning）と出力テキスト（タイトル・説明）は、すべて日本語で記述してください。",
        prompt: `Items to enhance: ${JSON.stringify(items, null, 2)}`,
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingLevel: "high",
              includeThoughts: true,
            },
          } satisfies GoogleGenerativeAIProviderOptions,
        },
        tools: {
          google_search: google.tools.googleSearch({}),
          imageSearch: buildImageSearch(ctx),
        },
        stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
      });

      return { enhancedText: text };
    },
  });
}
