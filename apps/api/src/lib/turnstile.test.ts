import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../env";
import { interpretSiteverify, verifyTurnstile } from "./turnstile";

describe("interpretSiteverify", () => {
  it("success=true を成功として扱う", () => {
    expect(interpretSiteverify({ success: true })).toEqual({
      success: true,
      bypassed: false,
      errorCodes: [],
    });
  });

  it("success=false と error-codes を取り出す", () => {
    const r = interpretSiteverify({ success: false, "error-codes": ["invalid-input-response"] });
    expect(r.success).toBe(false);
    expect(r.errorCodes).toEqual(["invalid-input-response"]);
  });

  it("想定外の形（null 等）でも安全に失敗で倒す", () => {
    expect(interpretSiteverify(null)).toEqual({ success: false, bypassed: false, errorCodes: [] });
    expect(interpretSiteverify("oops").success).toBe(false);
  });
});

describe("verifyTurnstile", () => {
  afterEach(() => vi.restoreAllMocks());

  it("secret 未設定ならバイパスして成功（ローカル開発）", async () => {
    const r = await verifyTurnstile({} as Bindings, undefined);
    expect(r).toEqual({ success: true, bypassed: true, errorCodes: [] });
  });

  it("secret 設定済みでトークン無しは missing-input-response で失敗", async () => {
    const r = await verifyTurnstile({ TURNSTILE_SECRET_KEY: "s" } as Bindings, undefined);
    expect(r).toEqual({ success: false, bypassed: false, errorCodes: ["missing-input-response"] });
  });

  it("siteverify が success を返せば成功する", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const r = await verifyTurnstile({ TURNSTILE_SECRET_KEY: "s" } as Bindings, "tok");
    expect(r.success).toBe(true);
    expect(r.bypassed).toBe(false);
  });

  it("siteverify が失敗を返せば error-codes 付きで失敗する", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false, "error-codes": ["timeout-or-duplicate"] }), {
        status: 200,
      }),
    );
    const r = await verifyTurnstile({ TURNSTILE_SECRET_KEY: "s" } as Bindings, "tok");
    expect(r.success).toBe(false);
    expect(r.errorCodes).toEqual(["timeout-or-duplicate"]);
  });

  it("siteverify への到達失敗は fail-closed（拒否）", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const r = await verifyTurnstile({ TURNSTILE_SECRET_KEY: "s" } as Bindings, "tok");
    expect(r.success).toBe(false);
    expect(r.errorCodes).toEqual(["internal-error"]);
  });
});
