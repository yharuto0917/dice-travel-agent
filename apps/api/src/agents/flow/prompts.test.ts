import type { TravelPlanDraft } from "@repo/shared";
import { describe, expect, it } from "vitest";
import { priorDaysSummary } from "./prompts";

function plan(days: TravelPlanDraft["days"]): TravelPlanDraft {
  return { title: "東京の旅", summary: "テスト", nights: 2, days };
}

describe("priorDaysSummary", () => {
  it("確定日程が無ければ初日メッセージを返す", () => {
    expect(priorDaysSummary(plan([]), 1)).toContain("最初の日");
  });

  it("当日より前の日だけを要約する（当日・以降は含めない）", () => {
    const p = plan([
      { dayNumber: 1, title: "浅草巡り", items: [{ id: "a", type: "spot", title: "浅草寺" }] },
      { dayNumber: 2, title: "新宿", items: [{ id: "b", type: "spot", title: "新宿御苑" }] },
    ]);
    const summary = priorDaysSummary(p, 2);
    expect(summary).toContain("浅草寺");
    expect(summary).not.toContain("新宿御苑"); // 当日(2日目)は含まない
  });

  it("前夜の宿泊地と前日の最終地点を抽出する", () => {
    const p = plan([
      {
        dayNumber: 1,
        title: "1日目",
        items: [
          { id: "a", type: "spot", title: "浅草寺" },
          { id: "b", type: "lodging", title: "上野ホテル" },
          { id: "c", type: "meal", title: "夜の居酒屋" },
        ],
      },
    ]);
    const summary = priorDaysSummary(p, 2);
    expect(summary).toContain("前夜の宿泊地: 上野ホテル");
    expect(summary).toContain("前日の最終地点: 夜の居酒屋");
  });

  it("items が空の日は要約に含めない", () => {
    const p = plan([
      { dayNumber: 1, title: "空の日", items: [] },
      { dayNumber: 2, title: "観光", items: [{ id: "x", type: "spot", title: "東京タワー" }] },
    ]);
    const summary = priorDaysSummary(p, 3);
    expect(summary).not.toContain("空の日");
    expect(summary).toContain("東京タワー");
  });
});
