import type { TravelPlan } from "@repo/shared";
import { describe, expect, it } from "vitest";
import { checkPlan } from "./checker";

function validPlan(): TravelPlan {
  return {
    id: "p1",
    status: "completed",
    destination: {
      id: "d1",
      prefectureCode: "13",
      prefecture: "東京都",
      location: { lat: 35.68, lng: 139.76 },
      tags: [],
    },
    conditions: {
      origin: "東京駅",
      themes: ["観光"],
      budgetRange: [0, 50000],
      nights: 1,
      partySize: 2,
      transportPreferences: [],
    },
    title: "東京1泊2日",
    summary: "テストプラン",
    nights: 1,
    days: [
      { dayNumber: 1, items: [{ id: "i1", type: "spot", title: "浅草" }] },
      { dayNumber: 2, items: [{ id: "i2", type: "spot", title: "渋谷" }] },
    ],
    budget: { total: { amount: 40000, currency: "JPY", approx: true } },
    images: [],
  };
}

describe("validation/checker", () => {
  it("accepts a fully valid plan", () => {
    const r = checkPlan(validPlan());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.parsed?.id).toBe("p1");
  });

  it("fails structural validation when required fields are missing", () => {
    const r = checkPlan({ title: "不完全" });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.parsed).toBeUndefined();
  });

  it("flags day-count mismatch (days !== nights + 1)", () => {
    const plan = validPlan();
    plan.days = [{ dayNumber: 1, items: [{ id: "i1", type: "spot", title: "浅草" }] }];
    const r = checkPlan(plan);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("日数が一致しません"))).toBe(true);
  });

  it("flags a day with no items", () => {
    const plan = validPlan();
    plan.days = plan.days.map((d) => (d.dayNumber === 2 ? { ...d, items: [] } : d));
    const r = checkPlan(plan);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("予定（items）がありません"))).toBe(true);
  });

  it("flags over-budget total (per-person max × party size)", () => {
    const plan = validPlan();
    // 上限 50000 × 2名 = 100000 を超える
    plan.budget = { total: { amount: 120000, currency: "JPY", approx: true } };
    const r = checkPlan(plan);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("超えています"))).toBe(true);
  });
});
