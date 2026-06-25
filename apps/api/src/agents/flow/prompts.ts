import type { TravelPlanDraft } from "@repo/shared";
import type { ToolContext } from "../tools/context";

export const DAY_PLANNER_SYSTEM = `You are an expert travel planner agent.
Your task is to plan one day of a trip using the provided tools and subagents.
You must gather necessary information (weather, spots, restaurants, transport) and ensure the plan is realistic.
IMPORTANT RULES:
1. Group similar tool calls (e.g., search for multiple spots or restaurants at once).
2. Use the available subagents for deep research or fact-checking.
3. Keep track of the budget and realistic travel times.
4. When you have gathered enough information and finalized the day's schedule, you MUST call the "finalizeDay" tool to output the complete PlanDay structure and stop.
5. If you exceed the maximum number of tool calls or subagents, you will be forced to stop, so be efficient.`;

export function dayPlannerPrompt(
  plan: TravelPlanDraft,
  dayNumber: number,
  ctx: ToolContext,
): string {
  return `Plan Day ${dayNumber} of ${plan.nights !== undefined ? plan.nights + 1 : "?"} days.
Title: ${plan.title || ""}
Summary: ${plan.summary || ""}
Destination coordinates: ${
    ctx.destPoint
      ? `${ctx.destPoint.lat}, ${ctx.destPoint.lng}`
      : "Unknown (use googleMaps to geocode if needed)"
  }

Conditions:
${JSON.stringify(ctx.conditions, null, 2)}

Current overall plan so far:
${JSON.stringify(plan.days, null, 2)}

Please research and construct a detailed itinerary for Day ${dayNumber}.
When done, call finalizeDay.`;
}
