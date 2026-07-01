import { describe, expect, it } from "vitest";
import { buildStatus, jstDayKey, nextResetAt, RATE_LIMITS } from "./rate-limit";

describe("jstDayKey", () => {
  it("UTC を JST(+9) の暦日へ変換する", () => {
    // 2026-06-28T10:00:00Z = 2026-06-28T19:00 JST → 同日
    expect(jstDayKey(new Date("2026-06-28T10:00:00Z"))).toBe("2026-06-28");
  });

  it("JST で日付が繰り上がる UTC 夜間を翌日として扱う", () => {
    // 2026-06-28T15:30:00Z = 2026-06-29T00:30 JST → 翌日
    expect(jstDayKey(new Date("2026-06-28T15:30:00Z"))).toBe("2026-06-29");
  });

  it("JST 0:00 ちょうど（UTC 前日 15:00）を新しい日として扱う", () => {
    expect(jstDayKey(new Date("2026-06-28T15:00:00Z"))).toBe("2026-06-29");
  });
});

describe("nextResetAt", () => {
  it("次の JST 0:00 を UTC(前日15:00Z) で返す", () => {
    // 2026-06-28 昼(JST) の次のリセットは 2026-06-29T00:00 JST = 2026-06-28T15:00Z
    expect(nextResetAt(new Date("2026-06-28T03:00:00Z"))).toBe("2026-06-28T15:00:00.000Z");
  });

  it("月をまたぐ日次リセットを正しく計算する", () => {
    // 2026-06-30 夜(JST) の次のリセットは 2026-07-01T00:00 JST = 2026-06-30T15:00Z
    expect(nextResetAt(new Date("2026-06-30T12:00:00Z"))).toBe("2026-06-30T15:00:00.000Z");
  });
});

describe("buildStatus", () => {
  const now = new Date("2026-06-28T03:00:00Z");

  it("残回数を上限から算出する", () => {
    const s = buildStatus("plan", 1, now);
    expect(s).toMatchObject({ scope: "plan", limit: 2, used: 1, remaining: 1 });
    expect(s.resetAt).toBe("2026-06-28T15:00:00.000Z");
  });

  it("上限超過でも残回数は 0 でクランプする", () => {
    expect(buildStatus("plan", 5, now).remaining).toBe(0);
  });

  it("スコープ別の上限（plan=2 / chat=20）を反映する", () => {
    expect(RATE_LIMITS).toEqual({ plan: 2, chat: 20 });
    expect(buildStatus("chat", 0, now).remaining).toBe(20);
  });
});
