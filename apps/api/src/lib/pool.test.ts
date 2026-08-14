import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./pool";

/** 指定 ms 後に解決する。 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapWithConcurrency", () => {
  it("入力と同じ順序で結果を返す", async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([
      2, 4, 6, 8, 10,
    ]);
  });

  it("同時実行数が上限を超えない", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await sleep(5);
        inFlight--;
      },
    );
    expect(peak).toBe(3);
  });

  it("1件が reject しても他は完走し、失敗は rejected として返る", async () => {
    const results = await mapWithConcurrency(["ok1", "ng", "ok2"], 2, async (v) => {
      if (v === "ng") throw new Error("boom");
      return v;
    });

    expect(results[0]).toEqual({ status: "fulfilled", value: "ok1" });
    expect(results[1]?.status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: "ok2" });
  });

  it("チャンク分割と違い、遅い1件が後続をブロックしない", async () => {
    // 並列2で [遅い(50ms), 速い(1ms), 速い(1ms)]。チャンク方式なら [遅い,速い] の
    // barrier を待ってから3件目が始まるので 50ms + 1ms かかる。プールなら
    // 2件目の完了直後に3件目が走り出すため、全体は遅い1件の 50ms 程度で収まる。
    const order: number[] = [];
    const started = Date.now();
    await mapWithConcurrency([50, 1, 1], 2, async (ms, i) => {
      await sleep(ms);
      order.push(i);
    });
    const elapsed = Date.now() - started;

    // 3件目は遅い1件より先に終わる（＝barrier を待っていない）。
    expect(order).toEqual([1, 2, 0]);
    expect(elapsed).toBeLessThan(120);
  });

  it("空配列は即座に空配列を返す", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it("並列数が 0 以下でも 1 として動作する（停止しない）", async () => {
    const results = await mapWithConcurrency([1, 2], 0, async (n) => n);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([1, 2]);
  });

  it("undefined を含む配列でも要素を飛ばさない", async () => {
    const results = await mapWithConcurrency(
      [undefined, 1, undefined],
      2,
      async (v) => v ?? "none",
    );
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([
      "none",
      1,
      "none",
    ]);
  });
});
