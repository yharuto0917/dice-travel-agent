import { TravelPlanDraftSchema, type TripConditions } from "@repo/shared";
import { describe, expect, it } from "vitest";
import { type FillContext, PLAN_PIPELINE } from "./pipeline";

const conditions = (nights: number, budgetMax = 60000): TripConditions => ({
  themes: ["温泉"],
  budgetRange: [0, budgetMax],
  nights,
  partySize: 2,
  transportPreferences: ["新幹線"],
});

/** index 0..末尾 までパイプラインを畳み込み、最終ドラフトを得る。 */
function runPipeline(ctx: FillContext) {
  return PLAN_PIPELINE.reduce((draft, step) => step.fill(draft, ctx), {});
}

describe("PLAN_PIPELINE", () => {
  it("フェーズが Issue #13 の想定フロー順で並ぶ", () => {
    expect(PLAN_PIPELINE.map((s) => s.phase)).toEqual([
      "understanding",
      "collecting",
      "designing",
      "lodging",
      "food",
      "transport",
      "budget",
      "finalizing",
    ]);
  });

  it("各ステップの出力が TravelPlanDraftSchema に適合する", () => {
    const ctx: FillContext = {
      conditions: conditions(1),
      destinationName: "京都府",
      nowIso: "2026-06-25T00:00:00.000Z",
    };
    let draft = {};
    for (const step of PLAN_PIPELINE) {
      draft = step.fill(draft, ctx);
      expect(TravelPlanDraftSchema.safeParse(draft).success).toBe(true);
    }
  });

  it("1泊2日: days が 2 日生成され、宿泊は初日のみ・食事は全日に付く", () => {
    const draft = runPipeline({ conditions: conditions(1), destinationName: "京都府" });
    const parsed = TravelPlanDraftSchema.parse(draft);
    expect(parsed.days).toHaveLength(2);
    const lodging = parsed.days?.flatMap((d) => d.items).filter((i) => i.type === "lodging");
    const meals = parsed.days?.flatMap((d) => d.items).filter((i) => i.type === "meal");
    expect(lodging).toHaveLength(1); // nights=1 → 初日のみ
    expect(meals).toHaveLength(2); // 全日
  });

  it("日帰り(0泊): days は 1 日・宿泊なし", () => {
    const draft = runPipeline({ conditions: conditions(0), destinationName: "三重県" });
    const parsed = TravelPlanDraftSchema.parse(draft);
    expect(parsed.days).toHaveLength(1);
    const lodging = parsed.days?.flatMap((d) => d.items).filter((i) => i.type === "lodging");
    expect(lodging).toHaveLength(0);
  });

  it("最終ドラフトは completed・予算内訳・タイトルが充填される", () => {
    const draft = runPipeline({
      conditions: conditions(2, 90000),
      destinationName: "北海道",
      nowIso: "2026-06-25T00:00:00.000Z",
    });
    const parsed = TravelPlanDraftSchema.parse(draft);
    expect(parsed.status).toBe("completed");
    expect(parsed.title).toContain("北海道");
    expect(parsed.nights).toBe(2);
    expect(parsed.budget?.total?.amount).toBe(90000);
    expect(parsed.createdAt).toBe("2026-06-25T00:00:00.000Z");
  });

  it("行き先名が無くてもフォールバックして有効なドラフトになる", () => {
    const draft = runPipeline({ conditions: conditions(1) });
    expect(TravelPlanDraftSchema.safeParse(draft).success).toBe(true);
  });
});
