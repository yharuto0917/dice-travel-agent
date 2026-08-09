import { describe, expect, it } from "vitest";
import type { Bindings } from "../env";
import { agentCorsHeaders, isAllowedOrigin } from "./cors";

const WEB_ORIGIN = "https://dice-travel-agent.yharuto.dev";

/** テストに必要なフィールドだけを持つ最小の env。 */
function env(overrides: Partial<Bindings> = {}): Bindings {
  return { WEB_ORIGIN, ...overrides } as Bindings;
}

function request(origin?: string): Request {
  return new Request("https://api.example.com/agents/travel-chat-agent/plan-1/get-messages", {
    headers: origin ? { origin } : {},
  });
}

describe("CORS 許可オリジンの判定", () => {
  it("本番フロント（WEB_ORIGIN）を許可する", () => {
    expect(isAllowedOrigin(WEB_ORIGIN, env())).toBe(true);
  });

  it("ローカル開発のオリジンを許可する", () => {
    expect(isAllowedOrigin("http://localhost:3000", env())).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000", env())).toBe(true);
  });

  it("許可リスト外のオリジンを拒否する", () => {
    expect(isAllowedOrigin("https://evil.example.com", env())).toBe(false);
    // 前方一致で通してしまわないこと（サブドメイン偽装の防止）。
    expect(isAllowedOrigin(`${WEB_ORIGIN}.evil.example.com`, env())).toBe(false);
  });

  it("WEB_ORIGIN 未設定でも本番オリジンを勝手に許可しない", () => {
    expect(isAllowedOrigin(WEB_ORIGIN, env({ WEB_ORIGIN: undefined }))).toBe(false);
  });
});

describe("Agent 経路の CORS ヘッダ", () => {
  it("許可オリジンにはワイルドカードではなくオリジンそのものを返す", () => {
    const headers = agentCorsHeaders(request(WEB_ORIGIN), env());
    // `credentials: "include"` の fetch では "*" がブラウザに拒否される。
    expect(headers?.["Access-Control-Allow-Origin"]).toBe(WEB_ORIGIN);
    expect(headers?.["Access-Control-Allow-Credentials"]).toBe("true");
  });

  it("オリジンごとに応答が変わることを Vary で示す", () => {
    expect(agentCorsHeaders(request(WEB_ORIGIN), env())?.Vary).toBe("Origin");
  });

  it("許可ヘッダを実値で列挙する（資格情報付きでは '*' が効かない）", () => {
    const headers = agentCorsHeaders(request(WEB_ORIGIN), env());
    expect(headers?.["Access-Control-Allow-Headers"]).not.toBe("*");
    expect(headers?.["Access-Control-Allow-Headers"]).toContain("Content-Type");
  });

  it("許可外オリジンにはヘッダを付けない", () => {
    expect(agentCorsHeaders(request("https://evil.example.com"), env())).toBeUndefined();
  });

  it("Origin ヘッダの無い呼び出し（非ブラウザ）にはヘッダを付けない", () => {
    expect(agentCorsHeaders(request(), env())).toBeUndefined();
  });
});
