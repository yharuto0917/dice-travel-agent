import type { TravelPlanDraft } from "@repo/shared";

/** 空日・日程欠落がある計画を completed として永続化しないための単一判定。 */
export function planPersistenceStatus(plan: TravelPlanDraft): "draft" | "completed" {
  const days = plan.days ?? [];
  return days.length > 0 && days.every((day) => day.items.length > 0) ? "completed" : "draft";
}
