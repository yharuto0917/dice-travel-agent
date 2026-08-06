import type { PlanDay, TravelPlan } from "@repo/shared";
import { describe, expect, it } from "vitest";
import {
  buildPendingEdit,
  buildResearchNotes,
  carryOverImages,
  cleanSummary,
  createReasoningReporter,
  isDegenerateDay,
  normalizeStartTime,
  resolveTargetDays,
  sanitizeGeneratedDay,
} from "./edit";

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
    origin: "東京駅",
    themes: [],
    budgetRange: [0, 100000],
    nights: 1,
    partySize: 1,
    transportPreferences: [],
  },
  title: "東京ミニ旅",
  summary: "1泊2日",
  nights: 1,
  days: [
    { dayNumber: 1, items: [{ id: "i1", type: "spot", title: "浅草寺" }] },
    { dayNumber: 2, items: [{ id: "i2", type: "spot", title: "渋谷" }] },
  ],
  images: [],
  createdAt: "2026-07-30T00:00:00.000Z",
};

describe("chat/edit resolveTargetDays", () => {
  it("計画に存在する日だけを対象にする", () => {
    expect(resolveTargetDays(plan, [1, 3])).toEqual([1]);
  });

  it("対象が特定できない（空）ときは空を返す", () => {
    // 全日を作り直すと出力上限で JSON が破綻し、指示と無関係な日まで変わってしまう。
    // 対象不明なら提案を作らず、呼び出し側で日にちの指定を促す。
    expect(resolveTargetDays(plan, [])).toEqual([]);
  });
});

describe("chat/edit buildPendingEdit", () => {
  it("現行計画との差分を提案に載せる", () => {
    const proposed: TravelPlan = {
      ...plan,
      days: [
        plan.days[0] as never,
        { dayNumber: 2, items: [{ id: "i9", type: "spot", title: "箱根温泉" }] },
      ],
    };

    const edit = buildPendingEdit(plan, proposed, "2日目を温泉中心に変更", new Date(0));

    expect(edit.summary).toBe("2日目を温泉中心に変更");
    expect(edit.proposedPlan.days[1]?.items[0]?.title).toBe("箱根温泉");
    expect(edit.createdAt).toBe("1970-01-01T00:00:00.000Z");

    const day2 = edit.diff.days.find((d) => d.dayNumber === 2);
    expect(day2?.change).toBe("changed");
    expect(day2?.items.map((i) => i.change)).toContain("added");
    expect(day2?.items.map((i) => i.change)).toContain("removed");

    const day1 = edit.diff.days.find((d) => d.dayNumber === 1);
    expect(day1?.change).toBe("unchanged");
  });

  it("提案ごとに一意な id を振る（承認の突き合わせに使う）", () => {
    const a = buildPendingEdit(plan, plan, "変更なし");
    const b = buildPendingEdit(plan, plan, "変更なし");
    expect(a.id).not.toBe(b.id);
  });
});

describe("chat/edit normalizeStartTime", () => {
  it("正しい HH:mm はそのまま通す", () => {
    expect(normalizeStartTime("09:30")).toBe("09:30");
    expect(normalizeStartTime("23:59")).toBe("23:59");
  });

  it("時刻の後ろに説明文が続く degeneration から時刻だけを救い出す", () => {
    // Gemini が startTime に指示文を混ぜてくる実際の失敗モード。regex 検証だけだと
    // このフィールドのせいで1日分の生成が丸ごと捨てられてしまう。
    expect(normalizeStartTime("08:30 Role-based check-out and prep time for the trip")).toBe(
      "08:30",
    );
    expect(normalizeStartTime("10:15 出発準備をします")).toBe("10:15");
  });

  it("1桁の時はゼロ埋めする", () => {
    expect(normalizeStartTime("9:05")).toBe("09:05");
  });

  it("時刻が無ければ捨てる（誤った時刻を作らない）", () => {
    expect(normalizeStartTime("午前中")).toBeUndefined();
    expect(normalizeStartTime("")).toBeUndefined();
    expect(normalizeStartTime(undefined)).toBeUndefined();
  });
});

describe("chat/edit sanitizeGeneratedDay", () => {
  it("dayNumber を要求値に固定し、startTime を正規化する", () => {
    const day = sanitizeGeneratedDay(
      {
        dayNumber: 9,
        items: [
          {
            id: "i1",
            type: "spot",
            title: "道後温泉本館",
            description: "日本最古級の温泉で朝風呂を楽しみます。",
            startTime: "08:30 入浴します",
          },
          {
            id: "i2",
            type: "meal",
            title: "鯛めし",
            description: "松山名物の鯛めしを昼食にいただきます。",
            startTime: "12:00",
          },
        ],
      },
      2,
    );

    expect(day.dayNumber).toBe(2);
    expect(day.items[0]?.startTime).toBe("08:30");
    expect(day.items[1]?.startTime).toBe("12:00");
  });

  it("退行で膨らんだ title / description を切り詰める", () => {
    const day = sanitizeGeneratedDay(
      {
        dayNumber: 1,
        items: [
          { id: "i1", type: "spot", title: "あ".repeat(300), description: "い".repeat(2000) },
        ],
      },
      1,
    );

    expect(day.items[0]?.title.length).toBeLessThanOrEqual(120);
    expect(day.items[0]?.description?.length).toBeLessThanOrEqual(800);
  });

  it("空白だけの description は未設定として落とす", () => {
    const day = sanitizeGeneratedDay(
      {
        dayNumber: 1,
        items: [{ id: "i1", type: "spot", title: "首里城", description: "  \n " }],
      },
      1,
    );

    expect(day.items[0]?.description).toBeUndefined();
  });

  it("モデルが書いた image は採用しない（URL は転記できないため）", () => {
    const day = sanitizeGeneratedDay(
      {
        dayNumber: 1,
        items: [
          {
            id: "i1",
            type: "spot",
            title: "首里城",
            description: "琉球王国の王城跡を巡ります。",
            image: { url: "https://example.com/hallucinated.png", generated: true },
          },
        ],
      },
      1,
    );

    expect(day.items[0]?.image).toBeUndefined();
  });
});

describe("chat/edit isDegenerateDay", () => {
  it("同じ予定の繰り返しで水増しされた日を弾く", () => {
    const day: PlanDay = {
      dayNumber: 1,
      items: [
        { id: "a", type: "spot", title: "倉吉白壁土蔵群散策" },
        { id: "b", type: "spot", title: "倉吉白壁土蔵群散策" },
        { id: "c", type: "spot", title: "倉吉白壁土蔵群散策" },
      ],
    };
    expect(isDegenerateDay(day)).toBe(true);
  });

  it("実質3件以上あれば通す", () => {
    const day: PlanDay = {
      dayNumber: 1,
      items: [
        { id: "a", type: "spot", title: "鳥取砂丘" },
        { id: "b", type: "meal", title: "海鮮丼のランチ" },
        { id: "c", type: "spot", title: "砂の美術館" },
      ],
    };
    expect(isDegenerateDay(day)).toBe(false);
  });
});

describe("chat/edit carryOverImages", () => {
  const withImage = (url: string): PlanDay["items"][number]["image"] => ({
    url,
    alt: "alt",
    generated: true,
  });

  it("同じ予定が残っていれば修正前の画像を引き継ぐ", () => {
    const previous: PlanDay = {
      dayNumber: 1,
      items: [
        { id: "a", type: "spot", title: "首里城", image: withImage("https://x/shuri.png") },
        { id: "b", type: "meal", title: "沖縄そば" },
      ],
    };
    const generated: PlanDay = {
      dayNumber: 1,
      items: [
        { id: "a2", type: "spot", title: "首里城" },
        { id: "b2", type: "meal", title: "ステーキ" },
      ],
    };

    const merged = carryOverImages(previous, generated);
    expect(merged.items[0]?.image?.url).toBe("https://x/shuri.png");
    expect(merged.items[1]?.image).toBeUndefined();
  });

  it("表記ゆれ（空白の有無）があっても引き継ぐ", () => {
    const previous: PlanDay = {
      dayNumber: 1,
      items: [
        {
          id: "a",
          type: "spot",
          title: "美ら海 水族館",
          image: withImage("https://x/churaumi.png"),
        },
      ],
    };
    const generated: PlanDay = {
      dayNumber: 1,
      items: [{ id: "a2", type: "spot", title: "美ら海水族館" }],
    };

    expect(carryOverImages(previous, generated).items[0]?.image?.url).toBe(
      "https://x/churaumi.png",
    );
  });

  it("場所名が一致すればタイトルが変わっても引き継ぐ", () => {
    const previous: PlanDay = {
      dayNumber: 1,
      items: [
        {
          id: "a",
          type: "spot",
          title: "首里城の見学",
          location: { name: "首里城公園" },
          image: withImage("https://x/shuri.png"),
        },
      ],
    };
    const generated: PlanDay = {
      dayNumber: 1,
      items: [{ id: "a2", type: "spot", title: "首里城を散策", location: { name: "首里城公園" } }],
    };

    expect(carryOverImages(previous, generated).items[0]?.image?.url).toBe("https://x/shuri.png");
  });

  it("修正前の日が無ければそのまま返す（新規に作る日）", () => {
    const generated: PlanDay = {
      dayNumber: 2,
      items: [{ id: "a", type: "spot", title: "斎場御嶽" }],
    };
    expect(carryOverImages(undefined, generated)).toBe(generated);
  });
});

describe("chat/edit buildResearchNotes", () => {
  it("まとめを先頭に、ツール結果を根拠として並べる", () => {
    const notes = buildResearchNotes("道後温泉本館が候補です", [
      { toolName: "touristSpotSearch", output: { spots: [{ name: "道後温泉本館" }] } },
    ]);

    expect(notes?.split("\n")[0]).toBe("道後温泉本館が候補です");
    expect(notes).toContain("[touristSpotSearch]");
    expect(notes).toContain("道後温泉本館");
  });

  it("中身の無いツール結果はメモに載せない", () => {
    // 検索が0件だった結果まで載せると、後段のプロンプトがノイズで膨らむ。
    const notes = buildResearchNotes("候補は見つかりませんでした", [
      { toolName: "restaurantSearch", output: {} },
      { toolName: "hotelSearch", output: null },
    ]);

    expect(notes).toBe("候補は見つかりませんでした");
  });

  it("何も得られなければ null を返す（プロンプトに空欄を作らない）", () => {
    expect(buildResearchNotes("   ", [])).toBeNull();
    expect(buildResearchNotes("", [{ toolName: "weather", output: [] }])).toBeNull();
  });

  it("長すぎるメモは切り詰める（文脈を食い潰さない）", () => {
    const notes = buildResearchNotes("あ".repeat(10000), []);
    expect(notes?.length).toBeLessThanOrEqual(3001);
    expect(notes?.endsWith("…")).toBe(true);
  });
});

describe("chat/edit createReasoningReporter", () => {
  it("しきい値までたまってから、その時点までの全文を流す", () => {
    const sent: string[] = [];
    const reporter = createReasoningReporter((text) => sent.push(text));

    reporter.append("あ".repeat(10));
    expect(sent).toHaveLength(0); // まだ細切れなので送らない

    reporter.append("い".repeat(80));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe("あ".repeat(10) + "い".repeat(80));
  });

  it("flush で端数を送り、同じ内容は二度送らない", () => {
    const sent: string[] = [];
    const reporter = createReasoningReporter((text) => sent.push(text));

    reporter.append("考え中");
    reporter.flush();
    reporter.flush();

    expect(sent).toEqual(["考え中"]);
  });

  it("見出しを Markdown の強調として差し込む", () => {
    const sent: string[] = [];
    const reporter = createReasoningReporter((text) => sent.push(text));

    reporter.section("2日目の下調べ");
    reporter.append("道後温泉を調べる");
    reporter.flush();

    expect(sent.at(-1)).toBe("**2日目の下調べ**\n道後温泉を調べる");
  });

  it("上限を超えた思考は打ち切る（transient data を肥大させない）", () => {
    const sent: string[] = [];
    const reporter = createReasoningReporter((text) => sent.push(text));

    reporter.append("あ".repeat(5000));
    reporter.append("この続きは載らない");
    reporter.flush();

    const last = sent.at(-1) ?? "";
    expect(last.length).toBeLessThanOrEqual(4001);
    expect(last.endsWith("…")).toBe(true);
    expect(last).not.toContain("この続きは載らない");
  });

  it("通知先が無ければ何もしない（思考を組み立てるコストも払わない）", () => {
    const reporter = createReasoningReporter(undefined);
    expect(() => {
      reporter.section("見出し");
      reporter.append("思考");
      reporter.flush();
    }).not.toThrow();
  });
});

describe("chat/edit cleanSummary", () => {
  it("モデルが付け足す文字数の注記を落とす", () => {
    // 「40文字以内」と指示すると本文へ「（24文字）」と書き足してくることがある。
    expect(cleanSummary("2日目の行程を温泉中心の内容に変更しました。（24文字）")).toBe(
      "2日目の行程を温泉中心の内容に変更しました。",
    );
  });

  it("前後の引用符を外し、1行目だけを使う", () => {
    expect(cleanSummary("「2日目を温泉中心に変更」")).toBe("2日目を温泉中心に変更");
    expect(cleanSummary("2日目を変更しました\n補足: ...")).toBe("2日目を変更しました");
  });

  it("空文字はそのまま空で返す（呼び出し側がフォールバックする）", () => {
    expect(cleanSummary("   ")).toBe("");
  });
});
