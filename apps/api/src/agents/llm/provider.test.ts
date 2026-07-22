import { describe, expect, it } from "vitest";
import type { Bindings } from "../../env";
import { createLlm, hasLlm, SUBAGENT_MODEL_ID, SUPERVISOR_MODEL_ID } from "./provider";

describe("llm/provider", () => {
  const env: Bindings = {
    AI_GATEWAY_ACCOUNT_ID: "account123",
    AI_GATEWAY_NAME: "gateway456",
    GEMINI_API_KEY: "secret",
    AI_GATEWAY_TOKEN: "cf-token",
  } as Bindings;

  it("should have hasLlm return true when GEMINI_API_KEY exists", () => {
    expect(hasLlm(env)).toBe(true);
  });

  it("should have hasLlm return false when GEMINI_API_KEY is missing", () => {
    expect(hasLlm({ ...env, GEMINI_API_KEY: undefined } as Bindings)).toBe(false);
  });

  it("should default to the supervisor model", () => {
    const llm = createLlm(env);
    expect(llm.modelId).toBe("gemini-3.6-flash");
    expect(llm.modelId).toBe(SUPERVISOR_MODEL_ID);
    expect(llm.provider).toBe("google.generative-ai");
  });

  it("should use the subagent model when specified", () => {
    const llm = createLlm(env, SUBAGENT_MODEL_ID);
    expect(llm.modelId).toBe("gemini-3.5-flash-lite");
  });
});
