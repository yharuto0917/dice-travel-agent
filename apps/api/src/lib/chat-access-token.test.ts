import { serialize, serializeSigned } from "hono/utils/cookie";
import { describe, expect, it } from "vitest";
import {
  CHAT_ACCESS_TTL_SEC,
  chatAccessCookieName,
  isChatAccessExpired,
  signChatAccessToken,
  verifyChatAccessRequest,
  verifyChatAccessToken,
} from "./chat-access-token";

const SECRET = "test-chat-access-secret";
const COOKIE_SECRET = "test-cookie-secret";
const NOW = 1_800_000_000;

const sign = (overrides: { planId?: string; clientId?: string } = {}) =>
  signChatAccessToken(
    SECRET,
    { planId: overrides.planId ?? "plan-1", clientId: overrides.clientId ?? "client-1" },
    NOW,
  );

describe("chat-access-token", () => {
  it("接続期限より前だけ有効とみなす", () => {
    expect(isChatAccessExpired(10_001, 10_000)).toBe(false);
    expect(isChatAccessExpired(10_000, 10_000)).toBe(true);
    expect(isChatAccessExpired(9_999, 10_000)).toBe(true);
    expect(isChatAccessExpired(Number.NaN, 10_000)).toBe(true);
  });

  it("発行したトークンを検証でき、payload を復元できる", async () => {
    const { token, expiresAt } = await sign();
    const result = await verifyChatAccessToken(SECRET, token, NOW);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.payload.planId).toBe("plan-1");
    expect(result.payload.clientId).toBe("client-1");
    expect(result.payload.purpose).toBe("travel-chat");
    expect(Date.parse(expiresAt)).toBe((NOW + CHAT_ACCESS_TTL_SEC) * 1000);
  });

  it("期限を過ぎたトークンは expired として拒否する", async () => {
    const { token } = await sign();
    const result = await verifyChatAccessToken(SECRET, token, NOW + CHAT_ACCESS_TTL_SEC + 1);
    expect(result).toEqual({ valid: false, reason: "expired" });
  });

  it("署名が別の鍵のトークンは bad_signature として拒否する", async () => {
    const { token } = await sign();
    const result = await verifyChatAccessToken("another-secret", token, NOW);
    expect(result).toEqual({ valid: false, reason: "bad_signature" });
  });

  it("payload を書き換えたトークンは署名不一致で拒否する", async () => {
    // planId を別計画へ差し替えても、署名は元の payload に対するものなので通らない。
    const { token } = await sign();
    const [, signature] = token.split(".");
    const forged = `${btoa(
      JSON.stringify({
        purpose: "travel-chat",
        planId: "plan-2",
        clientId: "client-1",
        exp: NOW + CHAT_ACCESS_TTL_SEC,
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}.${signature}`;

    const result = await verifyChatAccessToken(SECRET, forged, NOW);
    expect(result).toEqual({ valid: false, reason: "bad_signature" });
  });

  it("形式不正・未指定は malformed として拒否する", async () => {
    expect(await verifyChatAccessToken(SECRET, undefined, NOW)).toEqual({
      valid: false,
      reason: "malformed",
    });
    expect(await verifyChatAccessToken(SECRET, "not-a-token", NOW)).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("planId / clientId は payload に残るので呼び出し側で突き合わせられる", async () => {
    // トークン単体は「この planId を主張する」だけ。所有権の確認は呼び出し側の責務。
    const { token } = await sign({ planId: "plan-9", clientId: "client-9" });
    const result = await verifyChatAccessToken(SECRET, token, NOW);
    expect(result.valid && result.payload.planId).toBe("plan-9");
    expect(result.valid && result.payload.clientId).toBe("client-9");
  });

  it("access token と現在の署名付き cid が同じクライアントなら接続を許可する", async () => {
    const { token } = await sign();
    const access = serialize(chatAccessCookieName("plan-1"), token).split(";")[0];
    const cid = (await serializeSigned("cid", "client-1", COOKIE_SECRET)).split(";")[0];
    const request = new Request("https://api.example.com/agents/travel-chat-agent/plan-1", {
      headers: { cookie: `${access}; ${cid}` },
    });

    const result = await verifyChatAccessRequest(
      request,
      { chatAccess: SECRET, cookie: COOKIE_SECRET },
      "plan-1",
      NOW,
    );
    expect(result.valid).toBe(true);
  });

  it("URL から漏れた token を別の署名付き cid で再利用しても拒否する", async () => {
    const { token } = await sign({ clientId: "client-1" });
    const access = serialize(chatAccessCookieName("plan-1"), token).split(";")[0];
    const attackerCid = (await serializeSigned("cid", "client-2", COOKIE_SECRET)).split(";")[0];
    const request = new Request("https://api.example.com/agents/travel-chat-agent/plan-1", {
      headers: { cookie: `${access}; ${attackerCid}` },
    });

    const result = await verifyChatAccessRequest(
      request,
      { chatAccess: SECRET, cookie: COOKIE_SECRET },
      "plan-1",
      NOW,
    );
    expect(result.valid).toBe(false);
  });

  it("署名鍵が未設定なら発行・検証ともに落とす（黙って無認可にしない）", async () => {
    await expect(signChatAccessToken("", { planId: "p", clientId: "c" }, NOW)).rejects.toThrow(
      "CHAT_ACCESS_SECRET",
    );
    await expect(verifyChatAccessToken("", "whatever", NOW)).rejects.toThrow("CHAT_ACCESS_SECRET");
  });
});
