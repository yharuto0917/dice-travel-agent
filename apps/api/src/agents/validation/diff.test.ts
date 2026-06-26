import type { TravelPlanDraft } from "@repo/shared";
import { describe, expect, it } from "vitest";
import { diffPlans } from "./diff";

const base: TravelPlanDraft = {
  title: "東京の旅",
  summary: "概要A",
  nights: 1,
  days: [
    {
      dayNumber: 1,
      items: [
        { id: "i1", type: "spot", title: "浅草" },
        { id: "i2", type: "meal", title: "寿司" },
      ],
    },
    { dayNumber: 2, items: [{ id: "i3", type: "spot", title: "渋谷" }] },
  ],
  budget: { total: { amount: 40000, currency: "JPY", approx: true } },
};

describe("validation/diff", () => {
  it("reports no changes for identical plans", () => {
    const d = diffPlans(base, structuredClone(base));
    expect(d.titleChanged).toBe(false);
    expect(d.summaryChanged).toBe(false);
    expect(d.budgetChanged).toBe(false);
    expect(d.days.every((day) => day.change === "unchanged")).toBe(true);
  });

  it("detects title / summary / budget changes", () => {
    const next = structuredClone(base);
    next.title = "京都の旅";
    next.summary = "概要B";
    next.budget = { total: { amount: 60000, currency: "JPY", approx: true } };
    const d = diffPlans(base, next);
    expect(d.titleChanged).toBe(true);
    expect(d.summaryChanged).toBe(true);
    expect(d.budgetChanged).toBe(true);
  });

  it("detects added, removed, and changed items within a day", () => {
    const next = structuredClone(base);
    // 1日目: i1 を変更・i2 を削除・i4 を追加。2日目は据え置き。
    next.days = [
      {
        dayNumber: 1,
        items: [
          { id: "i1", type: "spot", title: "浅草寺（変更）" },
          { id: "i4", type: "activity", title: "人力車" },
        ],
      },
      { dayNumber: 2, items: [{ id: "i3", type: "spot", title: "渋谷" }] },
    ];
    const d = diffPlans(base, next);
    const day1 = d.days.find((x) => x.dayNumber === 1);
    expect(day1?.change).toBe("changed");
    const byTitle = Object.fromEntries((day1?.items ?? []).map((it) => [it.title, it.change]));
    expect(byTitle["浅草寺（変更）"]).toBe("changed");
    expect(byTitle["人力車"]).toBe("added");
    expect(byTitle["寿司"]).toBe("removed");
  });

  it("detects added and removed days", () => {
    const next = structuredClone(base);
    // 1日目据え置き、2日目を削除、3日目を追加。
    next.days = [
      {
        dayNumber: 1,
        items: [
          { id: "i1", type: "spot", title: "浅草" },
          { id: "i2", type: "meal", title: "寿司" },
        ],
      },
      { dayNumber: 3, items: [{ id: "i9", type: "spot", title: "お台場" }] },
    ];
    const d = diffPlans(base, next);
    expect(d.days.find((x) => x.dayNumber === 1)?.change).toBe("unchanged");
    expect(d.days.find((x) => x.dayNumber === 2)?.change).toBe("removed");
    expect(d.days.find((x) => x.dayNumber === 3)?.change).toBe("added");
  });
});
