import { PlanDaySchema } from "@repo/shared";
import { generateText, tool } from "ai";
import { z } from "zod";
import type { Bindings } from "../../env";
import { createLlm } from "../llm/provider";
import type { ToolContext } from "../tools/context";

export function buildSummarizeSubagent(env: Bindings, ctx: ToolContext) {
  return tool({
    description: "Summarize a full travel plan or a single day for chat or presentation.",
    // 計画全体（title/summary/days）と単日（days を 1 要素で渡す）の両方を表現できる
    // 構造化スキーマ。z.any() を避けてモデルに形を提示する。
    inputSchema: z.object({
      title: z.string().optional().describe("Plan title"),
      summary: z.string().optional().describe("Existing plan summary, if any"),
      days: z
        .array(PlanDaySchema)
        .optional()
        .describe("Days to summarize (one element for a single day)"),
    }),
    execute: async ({ title, summary, days }) => {
      ctx.usage.subagent();

      const { text } = await generateText({
        model: createLlm(env),
        system:
          "You are a summarizing subagent. Provide a concise, attractive summary of the travel plan or day provided.",
        prompt: `Data: ${JSON.stringify({ title, summary, days }, null, 2)}`,
      });

      return { summary: text };
    },
  });
}
