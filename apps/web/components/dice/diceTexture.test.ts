import { afterEach, describe, expect, it, vi } from "vitest";
// このテストは Node 環境（document なし）で実行される。
// モジュールの import 自体が document に触れていれば、この行で失敗する。
import { createDiceTexture, createDiceTextures } from "./diceTexture";

/** 2D コンテキストの最小スタブ。描画呼び出しは記録するだけで良い。 */
function stubCanvas(withContext: boolean) {
  const calls: string[] = [];
  const ctx = {
    fillStyle: "" as unknown,
    beginPath: () => calls.push("beginPath"),
    arc: () => calls.push("arc"),
    fill: () => calls.push("fill"),
    fillRect: () => calls.push("fillRect"),
    createRadialGradient: () => ({ addColorStop: () => calls.push("addColorStop") }),
  };
  const element = {
    width: 0,
    height: 0,
    getContext: (kind: string) => (withContext && kind === "2d" ? ctx : null),
  };
  vi.stubGlobal("document", { createElement: () => element });
  return { calls, element };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("diceTexture", () => {
  it("import しただけでは document に触れない（モジュールレベル生成の再発防止）", () => {
    // import 時にテクスチャを生成していると、document 不在の環境で
    // このファイルの読み込み自体が ReferenceError で落ちる。
    // ここへ到達できている時点で、副作用が無いことが保証される。
    expect(typeof createDiceTextures).toBe("function");
    expect(globalThis.document).toBeUndefined();
  });

  it("createDiceTextures は毎回あたらしい6枚を返す（マウント間で共有しない）", () => {
    stubCanvas(true);
    const first = createDiceTextures();
    const second = createDiceTextures();

    expect(first).toHaveLength(6);
    expect(second).toHaveLength(6);
    // 同一インスタンスが混ざっていれば、WebGL コンテキストを跨いだ共有が復活している。
    for (const texture of first) {
      expect(second).not.toContain(texture);
    }
  });

  it("2D コンテキストを取得できないときは黒ではなく地色へフォールバックし、記録を残す", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stubCanvas(false);

    const texture = createDiceTexture(1);

    expect(error).toHaveBeenCalled();
    // 空 canvas 由来の透明（=黒）テクスチャを返していないこと。
    const data = (texture as unknown as { image: { data: Uint8Array } }).image.data;
    expect(Array.from(data)).toEqual([253, 253, 253, 255]);
  });

  it("生成したテクスチャは dispose できる", () => {
    stubCanvas(true);
    const textures = createDiceTextures();
    expect(() => {
      for (const texture of textures) texture.dispose();
    }).not.toThrow();
  });
});
