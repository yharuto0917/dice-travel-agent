import { describe, expect, it } from "vitest";
import { AgentStateSchema } from "./agent";
import { TripConditionsSchema } from "./conditions";
import { DestinationCandidateSchema, DestinationCandidatesSchema } from "./destination";
import { DiceStateSchema, MAX_REROLLS } from "./dice";
import { TravelPlanSchema } from "./plan";

const candidate = (id: string) => ({
  id,
  prefectureCode: "13",
  prefecture: "東京都",
  location: { lat: 35.68, lng: 139.76 },
});

describe("DestinationCandidateSchema", () => {
  it("既定値（tags=[]）が適用される", () => {
    const parsed = DestinationCandidateSchema.parse(candidate("c1"));
    expect(parsed.tags).toEqual([]);
  });

  it("不正な都道府県コードは弾く", () => {
    expect(() =>
      DestinationCandidateSchema.parse({ ...candidate("c1"), prefectureCode: "99" }),
    ).toThrow();
  });
});

describe("DestinationCandidatesSchema", () => {
  it("6件ちょうどのみ受理する", () => {
    const six = Array.from({ length: 6 }, (_, i) => candidate(`c${i}`));
    expect(DestinationCandidatesSchema.parse(six)).toHaveLength(6);
    expect(() => DestinationCandidatesSchema.parse(six.slice(0, 5))).toThrow();
  });
});

describe("DiceStateSchema", () => {
  it("既定状態を生成できる", () => {
    const s = DiceStateSchema.parse({});
    expect(s).toMatchObject({ rolledFace: null, rerollCount: 0, confirmed: false });
  });

  it("振り直し上限を超えると弾く", () => {
    expect(() => DiceStateSchema.parse({ rerollCount: MAX_REROLLS + 1 })).toThrow();
  });
});

describe("TripConditionsSchema", () => {
  it("budgetLevel は必須", () => {
    expect(() => TripConditionsSchema.parse({})).toThrow();
    expect(TripConditionsSchema.parse({ budgetLevel: "mid" }).nights).toBe(1);
  });
});

describe("TravelPlanSchema", () => {
  it("最小構成の計画をパースできる", () => {
    const plan = TravelPlanSchema.parse({
      id: "p1",
      destination: candidate("c1"),
      conditions: { budgetLevel: "mid" },
      title: "東京ミニ旅",
      summary: "日帰りで巡るミニチュアの東京",
      nights: 0,
      days: [{ dayNumber: 1, items: [] }],
    });
    expect(plan.status).toBe("draft");
    expect(plan.images).toEqual([]);
  });
});

describe("AgentStateSchema", () => {
  it("既定状態は idle / 空の計画下書き", () => {
    const s = AgentStateSchema.parse({});
    expect(s.phase).toBe("idle");
    expect(s.questions).toEqual([]);
    expect(s.progress).toBe(0);
  });
});
