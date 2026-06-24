import { generateText, tool } from "ai";
import { z } from "zod";
import type { Bindings } from "../../env";
import { createLlm } from "../llm/provider";
import { buildCalculate } from "../tools/calculate";
import type { ToolContext } from "../tools/context";
import { buildTransportationSearch } from "../tools/transportation-search";

export function buildFactcheckSubagent(env: Bindings, ctx: ToolContext) {
  return tool({
    description:
      "Check the feasibility of a travel day plan (time overlap, realistic travel time, budget).",
    inputSchema: z.object({
      day: z.any().describe("The day plan object to check"),
      budget: z.number().optional().describe("Remaining budget"),
    }),
    execute: async ({ day, budget }) => {
      ctx.usage.subagent();

      const { text } = await generateText({
        model: createLlm(env),
        system:
          "You are a fact-checking subagent. Validate the travel times, budget constraints, and potential time overlaps. Output any issues found, or state if it is ok.",
        prompt: `Day plan: ${JSON.stringify(day, null, 2)}\nBudget: ${budget}`,
        tools: {
          transportationSearch: buildTransportationSearch(ctx),
          calculate: buildCalculate(ctx),
        },
      });

      return { issuesAndValidation: text };
    },
  });
}
