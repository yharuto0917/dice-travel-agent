import { describe, expect, it, vi } from "vitest";
import { deleteGeneratedImageKeys } from "./generate-image";

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
