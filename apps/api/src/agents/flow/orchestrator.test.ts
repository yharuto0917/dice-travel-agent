import type { PlanDay, PlanItem } from "@repo/shared";
import { generateObject, streamText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../tools/context";
import { generateItemImage } from "../tools/generate-image";
import { createUsageCounter } from "./judgement";
import {
  generateImagesForRepairedDays,
  type ImageAttemptBudget,
  imageBudgetForDay,
  imageSubject,
  MAX_GENERATED_IMAGES_PER_PLAN,
  remainingImageBudget,
  runDay,
  selectImageTargets,
} from "./orchestrator";

// LLM 呼び出しと画像生成だけを差し替える。tool()/stepCountIs() はツール定義の組み立てに
// 使われるため実物を残す（モックすると buildTools/buildSubagents が壊れる）。
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText: vi.fn(),
  generateObject: vi.fn(),
}));

vi.mock("../tools/generate-image", () => ({
  generateItemImage: vi.fn(),
}));

// createLlm はネットワークに触れないが、env 未設定で毎回プロバイダを組み立てる必要は無い。
vi.mock("../llm/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./../llm/provider")>()),
  createLlm: vi.fn(() => ({}) as never),
}));

/** テスト用の items を type 配列から組み立てる。 */
function items(types: PlanItem["type"][]): PlanDay["items"] {
  return types.map((type, i) => ({ id: `i${i}`, type, title: `${type}-${i}` }));
}

describe("selectImageTargets", () => {
  it("観光名所(spot: 優先度1)および体験(activity: 優先度2)を対象に選び、優先度順に並べる", () => {
    const targets = selectImageTargets(items(["spot", "meal", "lodging", "activity", "spot"]));
    // spot (0, 4) が priority 1、activity (3) が priority 2。
    expect(targets.map((t) => t.index)).toEqual([0, 4, 3]);
  });

  it("Agent の明示指定 (imagePriority) が type 由来の既定値に勝つ", () => {
    const list: (PlanItem & { imagePriority?: number })[] = [
      { id: "i0", type: "spot", title: "有名寺院", imagePriority: 3 }, // spot だが priority 3 に後回し
      { id: "i1", type: "meal", title: "名物料理", imagePriority: 1 }, // meal だが priority 1 で最優先
      { id: "i2", type: "activity", title: "陶芸体験" }, // 未指定のため activity 既定の priority 2
    ];
    const targets = selectImageTargets(list);
    expect(targets.map((t) => t.index)).toEqual([1, 2, 0]);
  });

  it("全項目が同順位のときは出現順（安定ソート）を保つ", () => {
    const list: (PlanItem & { imagePriority?: number })[] = [
      { id: "i0", type: "spot", title: "スポット0", imagePriority: 1 },
      { id: "i1", type: "spot", title: "スポット1", imagePriority: 1 },
      { id: "i2", type: "activity", title: "体験2", imagePriority: 1 },
    ];
    const targets = selectImageTargets(list);
    expect(targets.map((t) => t.index)).toEqual([0, 1, 2]);
  });

  it("観光名所・体験以外で priority 未指定のもの（食事/宿/移動/自由）には生成しない", () => {
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

describe("remainingImageBudget & imageBudgetForDay", () => {
  it("remainingImageBudget は AI 生成画像 (generated: true) のみをカウントして残枠を算出する", () => {
    const plan = {
      nights: 1,
      days: [
        {
          dayNumber: 1,
          items: [
            { id: "1", type: "spot" as const, title: "A", image: { url: "a", generated: true } },
            { id: "2", type: "spot" as const, title: "B", image: { url: "b", generated: false } }, // 検索画像
          ],
        },
      ],
    };
    expect(remainingImageBudget(plan)).toBe(MAX_GENERATED_IMAGES_PER_PLAN - 1);
  });

  it("imageBudgetForDay は工程数に応じて枠を割り当てる (ceil(items / 2))", () => {
    const plan = { nights: 0, days: [] }; // 日帰り（1日）
    // 4工程 → 2枠
    expect(imageBudgetForDay(plan, 1, 4)).toBe(2);
    // 5工程 → 3枠
    expect(imageBudgetForDay(plan, 1, 5)).toBe(3);
    // 6工程 → 3枠
    expect(imageBudgetForDay(plan, 1, 6)).toBe(3);
    // 10工程 → 5枠
    expect(imageBudgetForDay(plan, 1, 10)).toBe(5);
  });

  it("imageBudgetForDay は残日数に応じた公平配分を行う", () => {
    // 2泊3日（3日間）、残枠6枚
    const plan3Days = { nights: 2, days: [] };
    // 1日目（残3日）: 6 / 3 = 2枚
    expect(imageBudgetForDay(plan3Days, 1, 6)).toBe(2);

    // 1日目に2枚消費した後の2日目（残2日、残4枚）: 4 / 2 = 2枚
    const planDay2 = {
      nights: 2,
      days: [
        {
          dayNumber: 1,
          items: [
            { id: "1", type: "spot" as const, title: "A", image: { url: "a", generated: true } },
            { id: "2", type: "spot" as const, title: "B", image: { url: "b", generated: true } },
          ],
        },
      ],
    };
    expect(imageBudgetForDay(planDay2, 2, 6)).toBe(2);
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

describe("generateImagesForRepairedDays", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("空日から復旧した日だけ画像を生成し、既存日は触らない", async () => {
    const existingDay = { dayNumber: 2, items: items(["spot", "meal", "transport", "free"]) };
    const before = {
      title: "京都府の旅",
      nights: 1,
      days: [{ dayNumber: 1, items: [] }, existingDay],
    };
    const after = {
      ...before,
      days: [
        { dayNumber: 1, items: items(["spot", "activity", "meal", "transport"]) },
        existingDay,
      ],
    };
    vi.mocked(generateItemImage)
      .mockResolvedValueOnce({ url: "https://api.test/a.png", r2Key: "a", prompt: "spot-0" })
      .mockResolvedValueOnce({
        url: "https://api.test/b.png",
        r2Key: "b",
        prompt: "activity-1",
      });

    const result = await generateImagesForRepairedDays({} as never, before, after);

    expect(generateItemImage).toHaveBeenCalledTimes(2);
    expect(result.days?.[0]?.items.map((item) => item.image?.url)).toEqual([
      "https://api.test/a.png",
      "https://api.test/b.png",
      undefined,
      undefined,
    ]);
    expect(result.days?.[1]).toBe(existingDay);
  });

  it("修復日を跨いで残枠を正しく伝播して減らす", async () => {
    // 2日とも空日で、1日目4件(spot×4)、2日目4件(spot×4)
    const before = {
      title: "京都府の旅",
      nights: 1,
      days: [
        { dayNumber: 1, items: [] },
        { dayNumber: 2, items: [] },
      ],
    };
    const after = {
      ...before,
      days: [
        { dayNumber: 1, items: items(["spot", "spot", "spot", "spot"]) },
        { dayNumber: 2, items: items(["spot", "spot", "spot", "spot"]) },
      ],
    };
    vi.mocked(generateItemImage).mockResolvedValue({
      url: "https://api.test/img.png",
      r2Key: "k",
      prompt: "spot",
    });

    const result = await generateImagesForRepairedDays({} as never, before, after);
    // 1日目: 2日プランで残6枚、残2日 → 3枚生成
    // 2日目: 残3枚、残1日 → 2枚生成（4工程で上限2枚）
    // 合計 4 枚（1日目 4工程→min(2, 3)=2枚、2日目 4工程→min(2, 4)=2枚）
    const totalGenerated = (result.days ?? [])
      .flatMap((d) => d.items)
      .filter((i) => i.image?.generated).length;
    expect(totalGenerated).toBe(4);
  });
});

/**
 * runDay の障害耐性。ここが本 PR の中核で、いずれも「1点の失敗で “その日” が丸ごと
 * 消えない」ことを確かめる。streamText / generateObject / generateItemImage を差し替え、
 * DO ランタイム無しで各フォールバック経路を通す。
 */
describe("runDay の障害耐性", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** fullStream として消費できる async iterable を作る。 */
  function streamOf(parts: unknown[]) {
    return {
      fullStream: (async function* () {
        for (const part of parts) yield part;
      })(),
    };
  }

  /** for-await の開始直後に例外を投げるストリーム（接続断などの再現）。 */
  function throwingStream(error: Error) {
    return {
      fullStream: (async function* () {
        throw error;
        // biome-ignore lint/correctness/noUnreachable: async generator の型を満たすため
        yield {} as never;
      })(),
    };
  }

  /** structureDay が返す妥当な1日分（PlanDayGenSchema を満たす）。 */
  const structuredDay = {
    dayNumber: 1,
    title: "1日目",
    items: [
      { id: "s1", type: "spot", title: "清水寺", description: "京都を代表する古刹を参拝します。" },
      { id: "s2", type: "spot", title: "金閣寺", description: "金箔に覆われた舎利殿を眺めます。" },
      { id: "s3", type: "meal", title: "昼食", description: "美味しい湯豆腐をいただきます。" },
      { id: "s4", type: "transport", title: "移動", description: "バスで移動します。" },
    ],
  };

  function makeCtx(): ToolContext {
    return {
      env: {} as never,
      clients: {} as never,
      destPoint: { lat: 35.0, lng: 135.7 },
      conditions: {},
      usage: createUsageCounter(),
      hitl: { pending: [], answers: {}, askedCount: 0 },
    };
  }

  const plan = { title: "京都府の旅", summary: "テスト", nights: 1 };

  it("画像1枚が失敗しても日は残り、成功した分だけ画像が付く", async () => {
    vi.mocked(streamText).mockReturnValue(streamOf([]) as never);
    vi.mocked(generateObject).mockResolvedValue({ object: structuredDay } as never);
    // 対象は spot 2件。1枚目は例外、2枚目は成功させる。
    vi.mocked(generateItemImage)
      .mockRejectedValueOnce(new Error("image API down"))
      .mockResolvedValueOnce({
        url: "https://api.test/assets/x.png",
        r2Key: "x",
        prompt: "金閣寺",
      });

    const result = await runDay({} as never, makeCtx(), plan, 1);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    // 日そのものが捨てられていないこと（旧実装では Promise.all の reject で消えていた）。
    expect(result.day.items).toHaveLength(4);
    expect(result.day.items[0]?.image).toBeUndefined();
    expect(result.day.items[1]?.image?.url).toBe("https://api.test/assets/x.png");
  });

  it("失敗した画像生成も試行枠を消費し、日を跨いだ呼び出し総数を6件に制限する", async () => {
    const denseDay = {
      dayNumber: 1,
      title: "1日目",
      items: [
        { id: "s1", type: "spot", title: "清水寺", description: "古刹を参拝します。" },
        { id: "s2", type: "spot", title: "金閣寺", description: "舎利殿を眺めます。" },
        { id: "s3", type: "spot", title: "銀閣寺", description: "庭園を散策します。" },
        { id: "m1", type: "meal", title: "昼食", description: "京料理をいただきます。" },
        { id: "t1", type: "transport", title: "移動", description: "バスで移動します。" },
        { id: "l1", type: "lodging", title: "宿泊", description: "市内の宿に泊まります。" },
      ],
    };
    vi.mocked(streamText).mockImplementation(() => streamOf([]) as never);
    vi.mocked(generateObject).mockResolvedValue({ object: denseDay } as never);
    vi.mocked(generateItemImage).mockResolvedValue(null);

    const attemptBudget: ImageAttemptBudget = { remaining: MAX_GENERATED_IMAGES_PER_PLAN };
    let currentPlan = { ...plan, nights: 2, days: [] as PlanDay[] };

    for (let dayNumber = 1; dayNumber <= 3; dayNumber++) {
      const result = await runDay(
        {} as never,
        makeCtx(),
        currentPlan,
        dayNumber,
        undefined,
        undefined,
        attemptBudget,
      );
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      currentPlan = { ...currentPlan, days: [...currentPlan.days, result.day] };
    }

    // 旧実装は成功画像だけを数え、全失敗時に 2 + 3 + 3 = 8 件を再発行していた。
    expect(generateItemImage).toHaveBeenCalledTimes(MAX_GENERATED_IMAGES_PER_PLAN);
    expect(attemptBudget.remaining).toBe(0);
  });

  it("fullStream が例外を投げても日を失わず、構造化経路で復旧する", async () => {
    vi.mocked(streamText).mockReturnValue(throwingStream(new Error("connection reset")) as never);
    vi.mocked(generateObject).mockResolvedValue({ object: structuredDay } as never);
    vi.mocked(generateItemImage).mockResolvedValue(null);

    const result = await runDay({} as never, makeCtx(), plan, 1);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.day.items).toHaveLength(4);
  });

  it("error パートで根拠ゼロなら1回だけストリームを再試行する", async () => {
    vi.mocked(streamText)
      .mockReturnValueOnce(streamOf([{ type: "error", error: new Error("429") }]) as never)
      .mockReturnValueOnce(streamOf([{ type: "text-delta", text: "京都の1日目" }]) as never);
    vi.mocked(generateObject).mockResolvedValue({ object: structuredDay } as never);
    vi.mocked(generateItemImage).mockResolvedValue(null);

    const result = await runDay({} as never, makeCtx(), plan, 1);

    expect(streamText).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("ok");
  });

  it("再試行も error パートを返した場合は完了ではなく失敗として通知する", async () => {
    vi.mocked(streamText)
      .mockReturnValueOnce(streamOf([{ type: "error", error: new Error("429") }]) as never)
      .mockReturnValueOnce(streamOf([{ type: "error", error: new Error("503") }]) as never);
    vi.mocked(generateObject).mockResolvedValue({ object: structuredDay } as never);
    vi.mocked(generateItemImage).mockResolvedValue(null);
    const events: { groupId?: string | null; label: string; status?: string }[] = [];

    await runDay({} as never, makeCtx(), plan, 1, undefined, (event) => events.push(event));

    const retryResult = events.filter((event) => event.groupId === "retry-stream-1").at(-1);
    expect(retryResult).toMatchObject({
      label: "ストリームの再試行にも失敗しました",
      status: "error",
    });
  });

  it("根拠が集まっていれば error パートがあっても再試行しない", async () => {
    vi.mocked(streamText).mockReturnValue(
      streamOf([
        { type: "text-delta", text: "収集済みのメモ" },
        { type: "error", error: new Error("late failure") },
      ]) as never,
    );
    vi.mocked(generateObject).mockResolvedValue({ object: structuredDay } as never);
    vi.mocked(generateItemImage).mockResolvedValue(null);

    await runDay({} as never, makeCtx(), plan, 1);

    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("構造化にも失敗した日は空 items で返し、例外を伝播させない", async () => {
    vi.mocked(streamText).mockReturnValue(streamOf([]) as never);
    vi.mocked(generateObject).mockRejectedValue(new Error("structure failed"));
    vi.mocked(generateItemImage).mockResolvedValue(null);

    const result = await runDay({} as never, makeCtx(), plan, 3);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    // 呼び出し側（checker / fillEmptyDays）が後段で埋められるよう、空日として返す。
    expect(result.day).toEqual({ dayNumber: 3, title: "3日目", items: [] });
  });

  it("生成完了後の day.items から imagePriority が漏れなく除去される（漏れ止め回帰テスト）", async () => {
    const dayWithPriority = {
      dayNumber: 1,
      title: "1日目",
      items: [
        {
          id: "s1",
          type: "spot",
          title: "清水寺",
          description: "京都を代表する古刹を参拝します。",
          imagePriority: 1,
        },
      ],
    };
    vi.mocked(streamText).mockReturnValue(streamOf([]) as never);
    vi.mocked(generateObject).mockResolvedValue({ object: dayWithPriority } as never);
    vi.mocked(generateItemImage).mockResolvedValue({
      url: "https://api.test/assets/x.png",
      r2Key: "x",
      prompt: "清水寺",
    });

    const result = await runDay({} as never, makeCtx(), plan, 1);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect("imagePriority" in result.day.items[0]!).toBe(false);
  });
});
