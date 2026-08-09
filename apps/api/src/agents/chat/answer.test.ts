import { describe, expect, it } from "vitest";
import { AGENT_MAX_SUBAGENTS, AGENT_MAX_TOOL_CALLS, MAX_STEPS } from "../flow/judgement";
import { CHAT_MAX_OUTPUT_TOKENS, CHAT_MAX_STEPS, toolActivityLabel } from "./answer";

describe("chat/answer 上限設定", () => {
  it("1ターンのステップ上限は 2 以上（ツール結果をモデルへ戻すため）", () => {
    // AI SDK v6 は stopWhen 省略時 1 ステップで停止し、ツール結果が再投入されない。
    // 「検索はしたが答えない」応答を避けるため、往復できる余地を必ず残す。
    expect(CHAT_MAX_STEPS).toBeGreaterThanOrEqual(2);
  });

  it("会話のステップ上限は計画生成より短い（ツールループの暴走を抑える）", () => {
    expect(CHAT_MAX_STEPS).toBeLessThan(MAX_STEPS);
  });

  it("出力上限は吹き出しに収まる範囲に抑える", () => {
    expect(CHAT_MAX_OUTPUT_TOKENS).toBeGreaterThan(0);
    expect(CHAT_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(4096);
  });

  it("使用量上限（ツール呼び出し・サブエージェント）は正の値で共有されている", () => {
    expect(AGENT_MAX_TOOL_CALLS).toBeGreaterThan(0);
    expect(AGENT_MAX_SUBAGENTS).toBeGreaterThan(0);
  });
});

describe("chat/answer toolActivityLabel", () => {
  it("既知のツールは日本語ラベルへ変換する", () => {
    expect(toolActivityLabel("restaurantSearch")).toBe("飲食店を調べています");
    expect(toolActivityLabel("weather")).toBe("天気を調べています");
  });

  it("未知のツールもツール名を添えて表示できる", () => {
    expect(toolActivityLabel("somethingNew")).toContain("somethingNew");
  });
});
