import type { TripConditions } from "@repo/shared";
import { dayCountOf, nightsOf } from "./merge";

export type StepType =
  | { type: "setup" }
  | { type: "planDay"; dayNumber: number }
  | { type: "finalize" };

export function buildStepPlan(conditions?: TripConditions | null): StepType[] {
  const steps: StepType[] = [];

  // 1. setup step
  steps.push({ type: "setup" });

  // 2. per-day planning steps
  const days = dayCountOf(nightsOf(conditions?.nights));
  for (let i = 1; i <= days; i++) {
    steps.push({ type: "planDay", dayNumber: i });
  }

  // 3. finalize step
  steps.push({ type: "finalize" });

  return steps;
}
