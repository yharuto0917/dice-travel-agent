import type { TravelPlanDraft } from "@repo/shared";
import { describe, expect, it } from "vitest";
import { planPersistenceStatus } from "./plan-status";

function planWithDays(itemsPerDay: number[]): TravelPlanDraft {
  return {
    nights: itemsPerDay.length - 1,
    days: itemsPerDay.map((count, index) => ({
      dayNumber: index + 1,
      items: Array.from({ length: count }, (_, itemIndex) => ({
        id: `d${index + 1}-i${itemIndex + 1}`,
        type: "spot" as const,
        title: `予定${itemIndex + 1}`,
      })),
    })),
  };
}

describe("planPersistenceStatus", () => {
  it("すべての日に予定があれば completed を返す", () => {
    expect(planPersistenceStatus(planWithDays([1, 2]))).toBe("completed");
  });

  it("空日が1日でも残れば draft を返す", () => {
    expect(planPersistenceStatus(planWithDays([1, 0]))).toBe("draft");
  });

  it("days 自体が無い計画も draft を返す", () => {
    expect(planPersistenceStatus({})).toBe("draft");
  });

  it("宿泊数から期待される日数に足りなければ、既存日が非空でも draft を返す", () => {
    const plan = planWithDays([1, 1]);
    plan.nights = 2;
    expect(planPersistenceStatus(plan)).toBe("draft");
  });

  it("dayNumber が重複して別の日が欠落していれば draft を返す", () => {
    const plan = planWithDays([1, 1]);
    const [firstDay, secondDay] = plan.days ?? [];
    if (!firstDay || !secondDay) throw new Error("test setup failed");
    plan.days = [firstDay, { ...secondDay, dayNumber: 1 }];
    expect(planPersistenceStatus(plan)).toBe("draft");
  });
});
