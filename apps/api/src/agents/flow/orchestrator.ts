import type { PlanDay, TravelPlanDraft } from "@repo/shared";
import { PlanDaySchema } from "@repo/shared";
import { generateObject, generateText, tool } from "ai";
import { z } from "zod";
import type { Bindings } from "../../env";
import { createLlm } from "../llm/provider";
import { buildSubagents } from "../subagents";
import { buildTools } from "../tools";
import type { ToolContext } from "../tools/context";
import { DAY_PLANNER_SYSTEM, dayPlannerPrompt } from "./prompts";

export async function runDay(
  env: Bindings,
  ctx: ToolContext,
  plan: TravelPlanDraft,
  n: number,
): Promise<PlanDay> {
  let finalizedDay: PlanDay | null = null;

  const finalizeDay = tool({
    description: "Finalize the day plan and output the complete PlanDay structure.",
    inputSchema: z.object({
      day: PlanDaySchema,
    }),
    execute: async ({ day }) => {
      finalizedDay = day;
      return { success: true, message: "Day finalized successfully." };
    },
  });

  const allTools = {
    ...buildTools(env, ctx),
    ...buildSubagents(env, ctx),
    finalizeDay,
  };

  const { text } = await generateText({
    model: createLlm(env),
    system: DAY_PLANNER_SYSTEM,
    prompt: dayPlannerPrompt(plan, n, ctx),
    tools: allTools,
    onStepFinish: () => {
      // Optional logging per step
    },
    // AI SDK doesn't natively expose `stopWhen` in this format but we can abort or check conditions.
    // However, we rely on the agent calling `finalizeDay` to effectively stop (we can just stop when finalizedDay is set).
    // In actual implementation, `ai` v3's `maxSteps` handles loop, and we can't easily break early without returning from the tool in a way that stops.
    // Actually, `generateText` stops automatically if the model doesn't call any more tools.
  });

  if (finalizedDay) {
    return finalizedDay;
  }

  // Fallback: If it didn't call finalizeDay, try to extract a PlanDay from the last state
  const { object } = await generateObject({
    model: createLlm(env),
    schema: PlanDaySchema,
    system: "Extract the PlanDay from the conversation history or text.",
    prompt: `Text:\n${text}`,
  });

  return object;
}
