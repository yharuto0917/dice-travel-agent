import type { PlanDay, TravelPlanDraft } from "@repo/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

// generateObject はネットワーク（Gemini）を叩くためモックする。fillEmptyDays が
// 「空の日だけを再生成し、失敗してもその日を空のまま他日へ波及させない」挙動を検証する。
const generateObject = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObject(...args),
}));
// createLlm はモデルオブジェクトを返すだけ（generateObject がモックなので結果は使われない）。
vi.mock("../llm/provider", () => ({
  SUPERVISOR_MODEL_ID: "test-model",
  createLlm: () => ({}),
}));

import { fillEmptyDays } from "./fix";

const env = {} as never;

function draft(days: PlanDay[]): TravelPlanDraft {
  return {
    title: "東京の旅",
    summary: "テスト",
    nights: 1,
    conditions: {
      themes: [],
      budgetRange: [0, 50000],
      nights: 1,
      partySize: 2,
      transportPreferences: [],
    },
    destination: {
      id: "d1",
      prefectureCode: "13",
      prefecture: "東京都",
      location: { lat: 35.68, lng: 139.76 },
      tags: [],
    },
    days,
  };
}

describe("fillEmptyDays", () => {
  beforeEach(() => {
    generateObject.mockReset();
  });

  it("空の日が無ければ generateObject を呼ばずそのまま返す", async () => {
    const plan = draft([{ dayNumber: 1, items: [{ id: "i1", type: "spot", title: "浅草" }] }]);
    const result = await fillEmptyDays(env, plan);
    expect(generateObject).not.toHaveBeenCalled();
    expect(result).toBe(plan);
  });

  it("items が空の日だけを再生成し、埋まっている日は触らない", async () => {
    generateObject.mockResolvedValue({
      object: {
        dayNumber: 99, // モデルが別番号を返しても day.dayNumber に矯正されること
        title: "2日目",
        items: [{ id: "g1", type: "spot", title: "渋谷スクランブル交差点", startTime: "10:00" }],
      },
    });

    const plan = draft([
      { dayNumber: 1, items: [{ id: "i1", type: "spot", title: "浅草" }] },
      { dayNumber: 2, items: [] },
    ]);
    const result = await fillEmptyDays(env, plan);

    // 空の日(2日目)のぶんだけ呼ばれる。
    expect(generateObject).toHaveBeenCalledTimes(1);
    const [d1, d2] = result.days ?? [];
    expect(d1).toBe(plan.days?.[0]); // 1日目は不変
    expect(d2?.items).toHaveLength(1);
    expect(d2?.dayNumber).toBe(2); // 要求番号に矯正
  });

  it("再生成が throw した日は空のまま保持し、他日へ波及させない", async () => {
    generateObject
      .mockRejectedValueOnce(new Error("JSON broke")) // 1日目失敗
      .mockResolvedValueOnce({
        object: {
          dayNumber: 2,
          title: "2日目",
          items: [{ id: "g2", type: "meal", title: "寿司" }],
        },
      });

    const plan = draft([
      { dayNumber: 1, items: [] },
      { dayNumber: 2, items: [] },
    ]);
    const result = await fillEmptyDays(env, plan);

    expect(generateObject).toHaveBeenCalledTimes(2);
    const [d1, d2] = result.days ?? [];
    expect(d1?.items).toHaveLength(0); // 失敗日は空のまま
    expect(d2?.items).toHaveLength(1); // 成功日は埋まる
  });
});
