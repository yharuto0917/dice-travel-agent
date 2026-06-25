import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { Bindings } from "../../env";
import { SUBAGENT_MAX_STEPS } from "../flow/judgement";
import { createLlm } from "../llm/provider";
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
        model: createLlm(env),
        system:
          "You are an enhancement subagent. Improve the descriptions and titles of the given travel items to make them more attractive. You can also search for images if needed. Output the enhanced items in a structured format.",
        prompt: `Items to enhance: ${JSON.stringify(items, null, 2)}`,
        tools: {
          imageSearch: buildImageSearch(ctx),
        },
        stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
      });

      return { enhancedText: text };
    },
  });
}
