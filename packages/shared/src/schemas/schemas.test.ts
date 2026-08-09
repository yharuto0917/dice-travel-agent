import { describe, expect, it } from "vitest";
import { AgentStateSchema, PendingPlanEditSchema, TravelChatStateSchema } from "./agent";
import {
  CHAT_HISTORY_MAX_BOUNDARY_IDS,
  CHAT_HISTORY_MAX_LIMIT,
  ChatDataPartSchema,
  ChatHistoryQuerySchema,
  CreatePlanRequestSchema,
} from "./api-dto";
import { ImageRefSchema } from "./common";
import { TripConditionsSchema } from "./conditions";
import { DestinationCandidateSchema, DestinationCandidatesSchema } from "./destination";
import { DiceStateSchema, MAX_REROLLS } from "./dice";
import { PlanItemGenSchema, TravelPlanSchema } from "./plan";

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

  it("都道府県コードは 01〜47 のみ受理する", () => {
    // 有効な境界
    expect(() =>
      DestinationCandidateSchema.parse({ ...candidate("c1"), prefectureCode: "01" }),
    ).not.toThrow();
    expect(() =>
      DestinationCandidateSchema.parse({ ...candidate("c1"), prefectureCode: "47" }),
    ).not.toThrow();
    // 無効（48以降・00・範囲外）
    for (const code of ["00", "48", "49", "99"]) {
      expect(() =>
        DestinationCandidateSchema.parse({ ...candidate("c1"), prefectureCode: code }),
      ).toThrow();
    }
  });
});

describe("DestinationCandidatesSchema", () => {
  it("6件ちょうどのみ受理する", () => {
    const six = Array.from({ length: 6 }, (_, i) => candidate(`c${i}`));
    expect(DestinationCandidatesSchema.parse(six)).toHaveLength(6);
    expect(() => DestinationCandidatesSchema.parse(six.slice(0, 5))).toThrow();
  });
});

describe("ImageRefSchema", () => {
  it("URLを検証し、generated の既定は false", () => {
    const parsed = ImageRefSchema.parse({ url: "https://example.com/a.png" });
    expect(parsed.generated).toBe(false);
    expect(() => ImageRefSchema.parse({ url: "not-a-url" })).toThrow();
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
  it("既定値が正しく設定される（origin は後方互換のため空文字を既定値とする）", () => {
    const conditions = TripConditionsSchema.parse({});
    expect(conditions.origin).toBe("");
    expect(conditions.nights).toBe(1);
    expect(conditions.budgetRange).toEqual([0, 100000]);
  });
});

describe("CreatePlanRequestSchema", () => {
  const base = { destinationPrefCode: "13", destinationPref: "東京都" };

  it("出発地（origin）は入力境界で必須", () => {
    expect(() => CreatePlanRequestSchema.parse({ ...base, conditions: {} })).toThrow();
    expect(() =>
      CreatePlanRequestSchema.parse({ ...base, conditions: { origin: "  " } }),
    ).toThrow();
  });

  it("origin があれば作成リクエストとしてパースできる", () => {
    const req = CreatePlanRequestSchema.parse({ ...base, conditions: { origin: "東京駅" } });
    expect(req.conditions.origin).toBe("東京駅");
  });
});

describe("TravelPlanSchema", () => {
  it("最小構成の計画をパースできる", () => {
    const plan = TravelPlanSchema.parse({
      id: "p1",
      destination: candidate("c1"),
      conditions: { origin: "東京駅" },
      title: "東京ミニ旅",
      summary: "日帰りで巡るミニチュアの東京",
      nights: 0,
      days: [{ dayNumber: 1, items: [] }],
    });
    expect(plan.status).toBe("draft");
    expect(plan.images).toEqual([]);
  });
});

describe("PlanItemGenSchema", () => {
  it("生成 item の description は空白だけでは受理しない", () => {
    const base = { id: "i1", type: "spot", title: "首里城" } as const;
    expect(() => PlanItemGenSchema.parse({ ...base, description: " \n\t " })).toThrow();
    expect(
      PlanItemGenSchema.parse({ ...base, description: " 王城跡を巡ります。 " }).description,
    ).toBe("王城跡を巡ります。");
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

/** 承認待ちの修正提案（#20）のひな型。proposedPlan は完成スキーマを満たす。 */
const pendingEdit = () => ({
  id: "e1",
  summary: "2日目を温泉中心に変更しました",
  proposedPlan: {
    id: "p1",
    destination: candidate("c1"),
    conditions: { origin: "東京駅" },
    title: "東京ミニ旅",
    summary: "日帰りで巡るミニチュアの東京",
    nights: 0,
    days: [{ dayNumber: 1, items: [] }],
  },
  diff: { titleChanged: false, summaryChanged: false, budgetChanged: false, days: [] },
  createdAt: "2026-07-30T00:00:00.000Z",
});

describe("PendingPlanEditSchema", () => {
  it("完成スキーマを満たす提案は受理する", () => {
    const parsed = PendingPlanEditSchema.parse(pendingEdit());
    expect(parsed.proposedPlan.status).toBe("draft");
    expect(parsed.diff.days).toEqual([]);
    expect(parsed.generatedImageKeys).toEqual([]);
  });

  it("未完成の下書き（destination 欠落）は拒否する", () => {
    // 承認でそのまま D1 の現行計画を置き換えるため、部分的な計画は入り込ませない。
    const invalid = pendingEdit();
    const { destination: _destination, ...rest } = invalid.proposedPlan;
    expect(() => PendingPlanEditSchema.parse({ ...invalid, proposedPlan: rest })).toThrow();
  });
});

describe("TravelChatStateSchema", () => {
  it("既定状態は提案なし・適用バージョンなし", () => {
    const s = TravelChatStateSchema.parse({});
    expect(s.pendingEdit).toBeNull();
    expect(s.appliedVersion).toBeNull();
  });

  it("提案と適用バージョンを保持できる", () => {
    const s = TravelChatStateSchema.parse({ pendingEdit: pendingEdit(), appliedVersion: 3 });
    expect(s.pendingEdit?.id).toBe("e1");
    expect(s.appliedVersion).toBe(3);
  });
});

describe("ChatDataPartSchema", () => {
  it("AI SDK の data-<name> 形式をそのまま受理する", () => {
    expect(
      ChatDataPartSchema.parse({ type: "data-activity", data: { label: "調べています" } }),
    ).toMatchObject({ type: "data-activity" });
    expect(
      ChatDataPartSchema.parse({ type: "data-proposal", data: { editId: "e1" } }),
    ).toMatchObject({ type: "data-proposal" });
    expect(
      ChatDataPartSchema.parse({ type: "data-reasoning", data: { text: "2日目を…" } }),
    ).toMatchObject({ type: "data-reasoning" });
  });

  it("未知の data part は拒否する（UI 側で safeParse して無視する前提）", () => {
    expect(() => ChatDataPartSchema.parse({ type: "data-unknown", data: {} })).toThrow();
  });
});

describe("ChatHistoryQuerySchema", () => {
  it("limit 未指定なら既定値、文字列は数値へ変換する", () => {
    expect(ChatHistoryQuerySchema.parse({}).limit).toBe(20);
    expect(ChatHistoryQuerySchema.parse({ limit: "35" }).limit).toBe(35);
  });

  it("初回境界の候補はカンマ区切りで受け取り、空要素を落とす", () => {
    expect(
      ChatHistoryQuerySchema.parse({ beforeMessageIds: "m1,m2 , ,m3" }).beforeMessageIds,
    ).toEqual(["m1", "m2", "m3"]);
    expect(ChatHistoryQuerySchema.parse({}).beforeMessageIds).toEqual([]);
    expect(ChatHistoryQuerySchema.parse({ beforeMessageIds: "" }).beforeMessageIds).toEqual([]);
  });

  it("境界候補は上限件数までしか受け取らない（URL 肥大を防ぐ）", () => {
    const ids = Array.from({ length: CHAT_HISTORY_MAX_BOUNDARY_IDS + 5 }, (_, i) => `m${i}`);
    expect(
      ChatHistoryQuerySchema.parse({ beforeMessageIds: ids.join(",") }).beforeMessageIds,
    ).toHaveLength(CHAT_HISTORY_MAX_BOUNDARY_IDS);
  });

  it("limit の上限を超える値は拒否する", () => {
    expect(() =>
      ChatHistoryQuerySchema.parse({ limit: String(CHAT_HISTORY_MAX_LIMIT + 1) }),
    ).toThrow();
  });
});
