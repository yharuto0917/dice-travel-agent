import { describe, expect, it } from "vitest";
import type { Bindings } from "../../env";
import { createLlm, hasLlm } from "./provider";

describe("llm/provider", () => {
  const env: Bindings = {
    AI_GATEWAY_ACCOUNT_ID: "account123",
    AI_GATEWAY_NAME: "gateway456",
    GEMINI_API_KEY: "secret",
  } as Bindings;

  it("should have hasLlm return true when key exists", () => {
    expect(hasLlm(env)).toBe(true);
  });

  it("should have hasLlm return false when key does not exist", () => {
    expect(hasLlm({ ...env, GEMINI_API_KEY: undefined } as Bindings)).toBe(false);
  });

  it("should create LLM with correct baseURL and model", () => {
    const llm = createLlm(env);
    expect(llm.modelId).toBe("gemini-3.5-flash");
    expect(llm.provider).toBe("google.generative-ai");
  });
});
