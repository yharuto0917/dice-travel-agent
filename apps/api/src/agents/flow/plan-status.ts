import type { TravelPlanDraft } from "@repo/shared";

/** 空日・日程欠落がある計画を completed として永続化しないための単一判定。 */
export function planPersistenceStatus(plan: TravelPlanDraft): "draft" | "completed" {
  const days = plan.days ?? [];
  const nights = plan.nights;
  if (nights === undefined || !Number.isInteger(nights) || nights < 0) return "draft";

  const expectedDays = nights + 1;
  if (days.length !== expectedDays || days.some((day) => day.items.length === 0)) return "draft";

  // 件数だけ合っていても dayNumber が重複すると、別の日が欠落した不完全な計画になる。
  const dayNumbers = new Set(days.map((day) => day.dayNumber));
  for (let dayNumber = 1; dayNumber <= expectedDays; dayNumber++) {
    if (!dayNumbers.has(dayNumber)) return "draft";
  }

  return "completed";
}
