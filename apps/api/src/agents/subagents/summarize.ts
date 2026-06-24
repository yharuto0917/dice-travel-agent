import { generateText, tool } from "ai";
import { z } from "zod";
import type { Bindings } from "../../env";
import { createLlm } from "../llm/provider";
import type { ToolContext } from "../tools/context";

export function buildSummarizeSubagent(env: Bindings, ctx: ToolContext) {
  return tool({
    description: "Summarize a full travel plan or a single day for chat or presentation.",
    inputSchema: z.object({
      data: z.any().describe("The travel plan or day to summarize"),
    }),
    execute: async ({ data }) => {
      ctx.usage.subagent();

      const { text } = await generateText({
        model: createLlm(env),
        system:
          "You are a summarizing subagent. Provide a concise, attractive summary of the travel plan or day provided.",
        prompt: `Data: ${JSON.stringify(data, null, 2)}`,
      });

      return { summary: text };
    },
  });
}
