import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../env";
import { deleteGeneratedImageKeys, generateItemImage } from "./generate-image";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
    generateImage: vi.fn(),
  };
});

describe("deleteGeneratedImageKeys", () => {
  it("未採用の R2 key を重複排除してまとめて削除する", async () => {
    const remove = vi.fn(async (_keys: string | string[]) => {});
    await deleteGeneratedImageKeys({ delete: remove }, ["generated/a.png", "generated/a.png", ""]);

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(["generated/a.png"]);
  });

  it("key が無ければ R2 を呼ばない", async () => {
    const remove = vi.fn(async (_keys: string | string[]) => {});
    await deleteGeneratedImageKeys({ delete: remove }, []);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("generateItemImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const dummyEnv = {
    GEMINI_API_KEY: "dummy-key",
    BUCKET: {
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    },
    ASSET_BASE_URL: "https://api.test",
  } as unknown as Bindings;

  it("GEMINI_API_KEY が未設定なら即座に null を返す", async () => {
    const envWithoutKey = { ...dummyEnv, GEMINI_API_KEY: undefined } as unknown as Bindings;
    const res = await generateItemImage(envWithoutKey, "清水寺");
    expect(res).toBeNull();
  });

  it("プロンプト拡張が失敗しても決定的なフォールバックプロンプトで画像生成を行う", async () => {
    const { generateText, generateImage } = await import("ai");
    vi.mocked(generateText).mockRejectedValueOnce(new Error("API Error"));
    vi.mocked(generateImage).mockResolvedValueOnce({
      image: { uint8Array: new Uint8Array([1, 2, 3]) },
    } as never);

    const res = await generateItemImage(dummyEnv, "清水寺");
    expect(res).not.toBeNull();
    expect(res?.prompt).toBe("清水寺");
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("清水寺"),
      }),
    );
  });

  it("画像が空応答だった場合に1回再試行して成功すれば画像を返す", async () => {
    const { generateText, generateImage, NoImageGeneratedError } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({ text: "Generated prompt" } as never);
    vi.mocked(generateImage)
      .mockRejectedValueOnce(new NoImageGeneratedError({ responses: [] }))
      .mockResolvedValueOnce({
        image: { uint8Array: new Uint8Array([4, 5, 6]) },
      } as never);

    const res = await generateItemImage(dummyEnv, "金閣寺");
    expect(res).not.toBeNull();
    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateImage).mock.calls[0]?.[0].providerOptions?.google).toEqual({
      googleSearch: { searchTypes: { imageSearch: {}, webSearch: {} } },
      aspectRatio: "1:1",
    });
    expect(vi.mocked(generateImage).mock.calls[1]?.[0].providerOptions?.google).toEqual({
      aspectRatio: "1:1",
    });
  });

  it("画像生成が例外を送出した場合も throw せず null を返す", async () => {
    const { generateText, generateImage } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({ text: "Generated prompt" } as never);
    vi.mocked(generateImage).mockRejectedValueOnce(new Error("Network Failure"));

    const res = await generateItemImage(dummyEnv, "嵐山");
    expect(res).toBeNull();
  });
});
