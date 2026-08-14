import type { PlanDay, PlanItem } from "@repo/shared";
import { generateObject, streamText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../tools/context";
import { generateItemImage } from "../tools/generate-image";
import { createUsageCounter } from "./judgement";
import { imageSubject, runDay, selectImageTargets } from "./orchestrator";

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
    expect(result.day.items).toHaveLength(2);
    expect(result.day.items[0]?.image).toBeUndefined();
    expect(result.day.items[1]?.image?.url).toBe("https://api.test/assets/x.png");
  });

  it("fullStream が例外を投げても日を失わず、構造化経路で復旧する", async () => {
    vi.mocked(streamText).mockReturnValue(throwingStream(new Error("connection reset")) as never);
    vi.mocked(generateObject).mockResolvedValue({ object: structuredDay } as never);
    vi.mocked(generateItemImage).mockResolvedValue(null);

    const result = await runDay({} as never, makeCtx(), plan, 1);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.day.items).toHaveLength(2);
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
});
