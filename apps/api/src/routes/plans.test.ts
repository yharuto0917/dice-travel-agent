import { describe, expect, it } from "vitest";
import { type ChatCursor, decodeCursor, encodeCursor } from "./plans";

describe("routes/plans チャット履歴の cursor", () => {
  it("往復して同じ値へ戻る", () => {
    const cursor: ChatCursor = { createdAt: "2026-08-06T17:00:00.123Z", id: "b1" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("ミリ秒時刻とidをページ境界に保持する", () => {
    const cursor = { createdAt: "2026-08-06T17:00:00.001Z", id: "assistant-1" };
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
    expect(decodeCursor(btoa(JSON.stringify(["2026-08-06T17:00:00.000Z", ""])))).toBeNull();
  });
});
