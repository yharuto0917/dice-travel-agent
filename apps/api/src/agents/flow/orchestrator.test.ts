import type { PlanDay, PlanItem } from "@repo/shared";
import { describe, expect, it } from "vitest";
import { imageSubject, selectImageTargets } from "./orchestrator";

/** テスト用の items を type 配列から組み立てる。 */
function items(types: PlanItem["type"][]): PlanDay["items"] {
  return types.map((type, i) => ({ id: `i${i}`, type, title: `${type}-${i}` }));
}

describe("selectImageTargets", () => {
  it("観光名所(spot)および体験(activity)を対象に選ぶ", () => {
    const targets = selectImageTargets(items(["spot", "meal", "lodging", "activity", "spot"]));
    expect(targets.map((t) => t.index)).toEqual([0, 3, 4]);
  });

  it("観光名所・体験以外（食事/宿/移動/自由）には生成しない", () => {
    const targets = selectImageTargets(items(["meal", "lodging", "transport", "free"]));
    expect(targets).toEqual([]);
  });

  it("上限は6件（観光名所・体験が多い日でも6件で打ち切る）", () => {
    const targets = selectImageTargets(items(Array(9).fill("spot")));
    expect(targets).toHaveLength(6);
    expect(targets.map((t) => t.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("既に image を持つ観光名所は対象にしない", () => {
    const list: PlanDay["items"] = [
      {
        id: "i0",
        type: "spot",
        title: "既存画像",
        image: { url: "https://x/a.png", generated: false },
      },
      { id: "i1", type: "spot", title: "spot-1" },
      { id: "i2", type: "meal", title: "meal" },
    ];
    const targets = selectImageTargets(list);
    expect(targets.map((t) => t.index)).toEqual([1]);
  });

  it("観光名所を含まない日は空", () => {
    expect(selectImageTargets(items(["meal", "transport", "free"]))).toEqual([]);
  });

  it("limit を渡すとその枚数で打ち切る（修正経路の残り枠）", () => {
    const targets = selectImageTargets(items(["spot", "spot", "spot"]), 2);
    expect(targets.map((t) => t.index)).toEqual([0, 1]);
  });

  it("limit が 0 以下なら何も選ばない（枠を使い切った状態）", () => {
    expect(selectImageTargets(items(["spot", "spot"]), 0)).toEqual([]);
  });
});

describe("imageSubject", () => {
  it("場所名があれば優先し、目的地名で補強する", () => {
    const item: PlanItem = {
      id: "i0",
      type: "spot",
      title: "午前の散策",
      location: { name: "清水寺" },
    };
    expect(imageSubject(item, "京都")).toBe("清水寺（京都）");
  });

  it("場所名が無ければタイトルを使う", () => {
    const item: PlanItem = { id: "i0", type: "meal", title: "老舗の湯豆腐" };
    expect(imageSubject(item, "京都")).toBe("老舗の湯豆腐（京都）");
  });

  it("目的地名が無ければ主題のみ", () => {
    const item: PlanItem = { id: "i0", type: "spot", title: "嵐山" };
    expect(imageSubject(item, null)).toBe("嵐山");
  });
});

describe("runDay error handling and image generation robustness", () => {
  it("selectImageTargets は spot と activity の両方を対象に選ぶ", () => {
    const targets = selectImageTargets([
      { id: "1", type: "spot", title: "スポット1" },
      { id: "2", type: "activity", title: "陶芸体験" },
      { id: "3", type: "meal", title: "昼食" },
    ]);
    expect(targets.map((t) => t.index)).toEqual([0, 1]);
  });
});
