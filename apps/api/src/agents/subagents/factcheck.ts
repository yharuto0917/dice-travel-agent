import { PlanDaySchema } from "@repo/shared";
import { generateText, Output, stepCountIs, tool } from "ai";
import { google, GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { z } from "zod";
import type { Bindings } from "../../env";
import { SUBAGENT_MAX_STEPS } from "../flow/judgement";
import { createLlm } from "../llm/provider";
import { buildCalculate } from "../tools/calculate";
import type { ToolContext } from "../tools/context";
import { buildTransportationSearch } from "../tools/transportation-search";

export function buildFactcheckSubagent(env: Bindings, ctx: ToolContext) {
  return tool({
    description:
      "Check the feasibility of a travel day plan (time overlap, realistic travel time, budget).",
    inputSchema: z.object({
      day: PlanDaySchema.describe("The day plan to check"),
      budget: z.number().optional().describe("Remaining budget"),
    }),
    execute: async ({ day, budget }) => {
      ctx.usage.subagent();

      // stopWhen を指定しないと generateText は 1 ステップで止まり transportation/
      // calculate の結果がモデルに戻らない。ツール往復を許可しつつ構造化結果を返す。
      const { experimental_output } = await generateText({
        model: createLlm(env),
        system:
          "You are a fact-checking subagent. Validate the travel times, budget constraints, and potential time overlaps using the provided tools, then report whether the day is feasible and list concrete issues.",
        prompt: `Day plan: ${JSON.stringify(day, null, 2)}\nBudget: ${budget ?? "unspecified"}`,
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingLevel: "high",
              includeThoughts: true,
            },
          },
        },
        tools: {
          google_search: google.tools.googleSearch({}),
          transportationSearch: buildTransportationSearch(ctx),
          calculate: buildCalculate(ctx),
        },
        stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
        experimental_output: Output.object({
          schema: z.object({
            ok: z.boolean().describe("True if the day is feasible with no blocking issues"),
            issues: z.array(z.string()).describe("Concrete feasibility issues found"),
          }),
        }),
      });

      return experimental_output;
    },
  });
}
