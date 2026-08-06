import type { TravelPlan } from "@repo/shared";
import { describe, expect, it } from "vitest";
import {
  answerSystemPrompt,
  editDayPrompt,
  editResearchPrompt,
  intentSystemPrompt,
  planSummary,
} from "./prompts";

const plan: TravelPlan = {
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
    origin: "名古屋駅",
    themes: ["グルメ", "歴史"],
    budgetRange: [10000, 50000],
    nights: 1,
    partySize: 2,
    transportPreferences: [],
    customRequests: "歩きすぎない旅程で",
  },
  title: "東京ミニ旅",
  summary: "ミニチュアの東京を巡る1泊2日",
  nights: 1,
  days: [
    {
      dayNumber: 1,
      title: "下町めぐり",
      items: [
        { id: "i1", type: "spot", title: "浅草寺", startTime: "10:00" },
        { id: "i2", type: "meal", title: "天ぷら屋", startTime: "12:30" },
      ],
    },
    { dayNumber: 2, title: "西側へ", items: [{ id: "i3", type: "spot", title: "渋谷" }] },
  ],
  budget: { total: { amount: 40000, currency: "JPY", approx: true } },
  images: [],
  createdAt: "2026-07-30T00:00:00.000Z",
};

describe("chat/prompts planSummary", () => {
  it("計画の骨格（タイトル・目的地・日程・予算）を含む", () => {
    const summary = planSummary(plan);
    expect(summary).toContain("東京ミニ旅");
    expect(summary).toContain("東京都");
    expect(summary).toContain("1泊2日");
    expect(summary).toContain("40000");
  });

  it("条件（出発地・人数・テーマ・予算帯・要望）を含む", () => {
    const summary = planSummary(plan);
    expect(summary).toContain("名古屋駅");
    expect(summary).toContain("2名");
    expect(summary).toContain("グルメ・歴史");
    expect(summary).toContain("10000〜50000");
    expect(summary).toContain("歩きすぎない旅程で");
  });

  it("各日の予定を時刻付きで列挙する", () => {
    const summary = planSummary(plan);
    expect(summary).toContain("1日目");
    expect(summary).toContain("10:00 浅草寺");
    expect(summary).toContain("2日目");
    expect(summary).toContain("渋谷");
  });

  it("日帰り（nights=0）は「日帰り」と表記する", () => {
    expect(planSummary({ ...plan, nights: 0, days: [plan.days[0] as never] })).toContain("日帰り");
  });
});

describe("chat/prompts answerSystemPrompt", () => {
  it("日本語ルールと計画の要約を含む", () => {
    const prompt = answerSystemPrompt(plan);
    expect(prompt).toContain("日本語");
    expect(prompt).toContain("東京ミニ旅");
  });
});

describe("chat/prompts intentSystemPrompt", () => {
  it("日番号の範囲を計画の日数に合わせて指示する", () => {
    // 範囲を明示しないとモデルが存在しない日を返し、編集対象の解決で落ちる。
    expect(intentSystemPrompt(plan)).toContain("1〜2");
  });
});

describe("chat/prompts editDayPrompt", () => {
  it("対象日の現在の内容と利用者の指示を含む", () => {
    const prompt = editDayPrompt(plan, 2, "温泉中心にして");
    expect(prompt).toContain("2日目");
    expect(prompt).toContain("温泉中心にして");
    expect(prompt).toContain("渋谷");
  });

  it("存在しない日を指定された場合は新規作成として案内する", () => {
    expect(editDayPrompt(plan, 5, "追加して")).toContain("まだ予定がありません");
  });

  it("下調べのメモがあれば候補として渡す", () => {
    const prompt = editDayPrompt(plan, 2, "温泉中心にして", "[touristSpotSearch] 道後温泉本館");
    expect(prompt).toContain("下調べで見つかった候補");
    expect(prompt).toContain("道後温泉本館");
  });

  it("メモが無いときは候補セクション自体を出さない", () => {
    // 空見出しだけ渡すと「候補が無い＝使える場所が無い」と読ませてしまう。
    expect(editDayPrompt(plan, 2, "温泉中心にして", null)).not.toContain("下調べ");
  });
});

describe("chat/prompts editResearchPrompt", () => {
  it("指示・対象日の現状・行き先を調査の手掛かりとして渡す", () => {
    const prompt = editResearchPrompt(plan, 2, "温泉中心にして");
    expect(prompt).toContain("温泉中心にして");
    expect(prompt).toContain("渋谷");
    expect(prompt).toContain("東京都");
  });

  it("予定の無い日でも調査できる", () => {
    expect(editResearchPrompt(plan, 5, "追加して")).toContain("まだ予定がありません");
  });
});
