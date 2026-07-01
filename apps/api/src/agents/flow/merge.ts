import type { PlanDay, TravelPlanDraft } from "@repo/shared";

/**
 * Merges a generated PlanDay into the TravelPlanDraft in an idempotent manner.
 * Replaces the day with the same dayNumber.
 */
export function mergeDay(plan: TravelPlanDraft, day: PlanDay): TravelPlanDraft {
  const newDays = [...(plan.days || [])];
  const index = newDays.findIndex((d) => d.dayNumber === day.dayNumber);

  if (index !== -1) {
    newDays[index] = day;
  } else {
    newDays.push(day);
    newDays.sort((a, b) => a.dayNumber - b.dayNumber);
  }

  return { ...plan, days: newDays };
}

export const dayCountOf = (nights: number = 1): number => nights + 1;
export const nightsOf = (nights?: number | null): number => nights ?? 1;
