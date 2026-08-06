import { describe, expect, it } from "vitest";
import { type ChatCursor, decodeCursor, encodeCursor } from "./plans";

describe("routes/plans チャット履歴の cursor", () => {
  it("往復して同じ値へ戻る", () => {
    const cursor: ChatCursor = { createdAt: "2026-07-30 10:00:00", id: "b1" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("空白を含む D1 の CURRENT_TIMESTAMP でも境界がずれない", () => {
    // D1 の既定値は "YYYY-MM-DD HH:MM:SS"。区切り文字で連結すると日付だけを日時と
    // 誤読してページ境界がずれ、履歴の重複・欠落が起きる。
    const cursor: ChatCursor = { createdAt: "2026-07-30 23:59:59", id: "a-b-c" };
    const decoded = decodeCursor(encodeCursor(cursor));
    expect(decoded?.createdAt).toBe("2026-07-30 23:59:59");
    expect(decoded?.id).toBe("a-b-c");
  });

  it("UUID のように区切り文字を含む id も保持する", () => {
    const cursor: ChatCursor = {
      createdAt: "2026-07-30 10:00:00",
      id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("未指定・壊れた cursor は null（先頭ページ扱い）にする", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("!!!not-base64!!!")).toBeNull();
    // base64 として復号できても中身が期待形でないものは弾く。
    expect(decodeCursor(btoa("plain text"))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify(["only-one"])))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ createdAt: "x", id: "y" })))).toBeNull();
  });

  it("空文字を含む cursor は無効として扱う", () => {
    expect(decodeCursor(btoa(JSON.stringify(["", "id"])))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify(["2026-07-30 10:00:00", ""])))).toBeNull();
  });
});
