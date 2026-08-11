import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markImagesEager, preparePrintAssets, toPrintDocumentTitle } from "./print";

describe("toPrintDocumentTitle", () => {
  it("タイトルが正常に指定されている場合は「旅のしおり_タイトル」を返す", () => {
    expect(toPrintDocumentTitle("京都・奈良の旅")).toBe("旅のしおり_京都・奈良の旅");
    expect(toPrintDocumentTitle("  東京観光  ")).toBe("旅のしおり_東京観光");
  });

  it("禁止文字や改行が含まれる場合は除去する", () => {
    expect(toPrintDocumentTitle("京都/大阪:観光?*plan")).toBe("旅のしおり_京都大阪観光plan");
    expect(toPrintDocumentTitle("タイトル\n改行\rあり")).toBe("旅のしおり_タイトル改行あり");
    expect(toPrintDocumentTitle('ファイル名 "<test>|*?"')).toBe("旅のしおり_ファイル名 test");
  });

  it("タイトルが null, undefined, または空文字の場合は「旅のしおり」を返す", () => {
    expect(toPrintDocumentTitle(null)).toBe("旅のしおり");
    expect(toPrintDocumentTitle(undefined)).toBe("旅のしおり");
    expect(toPrintDocumentTitle("")).toBe("旅のしおり");
    expect(toPrintDocumentTitle("   ")).toBe("旅のしおり");
  });

  it("禁止文字の除去後に空文字になった場合も「旅のしおり」を返す", () => {
    expect(toPrintDocumentTitle(' / \\ : * ? " < > | ')).toBe("旅のしおり");
  });
});

describe("markImagesEager", () => {
  it("配下の画像を同期的に eager / sync へ倒し、対象一覧を返す", () => {
    const images = [
      { loading: "lazy", decoding: "async" },
      { loading: "lazy", decoding: "async" },
    ] as unknown as HTMLImageElement[];
    const root = {
      querySelectorAll: vi.fn().mockReturnValue(images),
    } as unknown as HTMLElement;

    const result = markImagesEager(root);

    expect(result).toHaveLength(2);
    for (const img of images) {
      expect(img.loading).toBe("eager");
      expect(img.decoding).toBe("sync");
    }
  });
});

describe("preparePrintAssets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createMockRoot(images: Partial<HTMLImageElement>[]) {
    return {
      querySelectorAll: vi.fn().mockReturnValue(images),
    } as unknown as HTMLElement;
  }

  it("画像が0枚の場合、failed: 0, total: 0 で即座に解決する", async () => {
    const root = createMockRoot([]);
    const resultPromise = preparePrintAssets(root);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.total).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("ロード済みの画像も decode 完了を待って成功扱いにする", async () => {
    const mockImg: Record<string, unknown> = {
      loading: "lazy",
      decoding: "async",
      complete: true,
      naturalWidth: 100,
      decode: vi.fn().mockResolvedValue(undefined),
    };

    const root = createMockRoot([mockImg as unknown as HTMLImageElement]);
    const resultPromise = preparePrintAssets(root);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockImg.loading).toBe("eager");
    expect(mockImg.decoding).toBe("sync");
    expect(mockImg.decode).toHaveBeenCalledOnce();
    expect(result.total).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("ロード済み画像の decode が失敗した場合は failed にカウントする", async () => {
    const mockImg: Record<string, unknown> = {
      loading: "lazy",
      decoding: "async",
      complete: true,
      naturalWidth: 100,
      decode: vi.fn().mockRejectedValue(new Error("Decode error")),
    };

    const root = createMockRoot([mockImg as unknown as HTMLImageElement]);
    const resultPromise = preparePrintAssets(root);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.total).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("decode() がエラーになる画像があっても failed としてカウントし解決する", async () => {
    const listeners: Record<string, EventListener> = {};
    const mockImg: Record<string, unknown> = {
      loading: "lazy",
      complete: false,
      naturalWidth: 0,
      decode: vi.fn().mockRejectedValue(new Error("Decode error")),
      addEventListener: vi.fn((event: string, cb: EventListener) => {
        listeners[event] = cb;
      }),
      removeEventListener: vi.fn((event: string) => {
        delete listeners[event];
      }),
    };

    const root = createMockRoot([mockImg as unknown as HTMLImageElement]);
    const resultPromise = preparePrintAssets(root);

    // decode失敗後、onerrorを発火させる
    setTimeout(() => {
      listeners.error?.(new Event("error"));
    }, 100);

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.total).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("タイムアウトする画像があっても指定時間内に完了し failed にカウントされる", async () => {
    const mockImg: Record<string, unknown> = {
      loading: "lazy",
      complete: false,
      naturalWidth: 0,
      decode: vi.fn().mockReturnValue(new Promise(() => {})),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const root = createMockRoot([mockImg as unknown as HTMLImageElement]);
    const resultPromise = preparePrintAssets(root, { timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1001);
    const result = await resultPromise;

    expect(result.total).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("globalThis.document が存在しない環境では fontsReady: false で解決する", async () => {
    const originalDocument = globalThis.document;
    const globalRef = globalThis as unknown as { document?: Document };
    delete globalRef.document;

    try {
      const root = createMockRoot([]);
      const resultPromise = preparePrintAssets(root);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.fontsReady).toBe(false);
    } finally {
      globalRef.document = originalDocument;
    }
  });

  it("document.fonts.ready が正常解決すれば fontsReady: true になる", async () => {
    const originalDocument = globalThis.document;
    const globalRef = globalThis as unknown as { document?: unknown };
    globalRef.document = {
      fonts: { ready: Promise.resolve() as unknown as Promise<FontFaceSet> },
    };

    try {
      const root = createMockRoot([]);
      const resultPromise = preparePrintAssets(root);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.fontsReady).toBe(true);
    } finally {
      globalRef.document = originalDocument;
    }
  });
});
