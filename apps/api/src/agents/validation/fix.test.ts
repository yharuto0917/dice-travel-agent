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
      origin: "東京駅",
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

  it("非空と空が交互でも、生成結果が正しい日に入る（位置マッピングの検証）", async () => {
    // 並列プールは対象（空日）だけを詰めて回すため、結果を元の days へ戻す際の
    // 添字対応がずれると「別の日の内容で上書き」が起きる。プロンプトの日番号から
    // 内容を作って、どの日にどの結果が入ったかを直接照合する。
    generateObject.mockImplementation(async (args: { prompt: string }) => {
      const n = Number(/対象は (\d+)日目/.exec(args.prompt)?.[1] ?? 0);
      return {
        object: {
          dayNumber: 99,
          title: `${n}日目`,
          items: [{ id: `g${n}`, type: "spot", title: `生成-${n}` }],
        },
      };
    });

    const plan = draft([
      { dayNumber: 1, items: [{ id: "i1", type: "spot", title: "浅草" }] },
      { dayNumber: 2, items: [] },
      { dayNumber: 3, items: [{ id: "i3", type: "spot", title: "上野" }] },
      { dayNumber: 4, items: [] },
    ]);
    const result = await fillEmptyDays(env, plan);

    expect(generateObject).toHaveBeenCalledTimes(2);
    const [d1, d2, d3, d4] = result.days ?? [];
    // 非空の日は参照ごと不変。
    expect(d1).toBe(plan.days?.[0]);
    expect(d3).toBe(plan.days?.[2]);
    // 空だった日にはその日番号で生成された内容が入る（取り違えていない）。
    expect(d2?.items[0]?.title).toBe("生成-2");
    expect(d2?.dayNumber).toBe(2);
    expect(d4?.items[0]?.title).toBe("生成-4");
    expect(d4?.dayNumber).toBe(4);
  });

  it("空日が並列上限を超えても全件を再生成し、並び順を保つ", async () => {
    generateObject.mockImplementation(async (args: { prompt: string }) => {
      const n = Number(/対象は (\d+)日目/.exec(args.prompt)?.[1] ?? 0);
      return {
        object: {
          dayNumber: n,
          title: `${n}日目`,
          items: [{ id: `g${n}`, type: "spot", title: `生成-${n}` }],
        },
      };
    });

    const plan = draft(Array.from({ length: 5 }, (_, i) => ({ dayNumber: i + 1, items: [] })));
    const result = await fillEmptyDays(env, plan);

    expect(generateObject).toHaveBeenCalledTimes(5);
    expect(result.days?.map((d) => d.items[0]?.title)).toEqual([
      "生成-1",
      "生成-2",
      "生成-3",
      "生成-4",
      "生成-5",
    ]);
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
