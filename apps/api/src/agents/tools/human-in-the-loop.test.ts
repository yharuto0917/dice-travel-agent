import { describe, expect, it } from "vitest";
import { createUsageCounter, MAX_HITL_QUESTIONS } from "../flow/judgement";
import type { ToolContext } from "./context";
import { buildHumanInTheLoop, HITL_LIMIT_REACHED, HITL_PENDING } from "./human-in-the-loop";

function makeCtx(askedCount = 0): ToolContext {
  return {
    clients: {} as ToolContext["clients"],
    destPoint: null,
    conditions: {},
    usage: createUsageCounter(),
    hitl: { pending: [], answers: {}, askedCount },
  };
}

// AI SDK の tool() は execute を直接呼べる（toolCallId 等は任意）。
type ToolWithExecute = {
  execute: (
    input: { question: string; options?: string[] },
    opts: unknown,
  ) => Promise<{ status: string; questionId?: string; message?: string }>;
};

describe("tools/human-in-the-loop", () => {
  it("pushes a pending question and returns the HITL_PENDING sentinel", async () => {
    const ctx = makeCtx();
    const t = buildHumanInTheLoop(ctx) as unknown as ToolWithExecute;

    const result = await t.execute({ question: "日程の優先度は？", options: ["温泉", "観光"] }, {});

    expect(result.status).toBe(HITL_PENDING);
    expect(ctx.hitl.pending).toHaveLength(1);
    expect(ctx.hitl.pending[0]).toMatchObject({
      question: "日程の優先度は？",
      options: ["温泉", "観光"],
      status: "pending",
    });
    expect(result.questionId).toBe(ctx.hitl.pending[0]?.id);
    expect(ctx.usage.toolCalls).toBe(1);
  });

  it("上限に達していると質問を積まず HITL_LIMIT_REACHED を返す", async () => {
    // すでに上限ぶん質問済みの状態。
    const ctx = makeCtx(MAX_HITL_QUESTIONS);
    const t = buildHumanInTheLoop(ctx) as unknown as ToolWithExecute;

    const result = await t.execute({ question: "もう一つ質問" }, {});

    expect(result.status).toBe(HITL_LIMIT_REACHED);
    expect(ctx.hitl.pending).toHaveLength(0); // 積まれない
    expect(ctx.usage.toolCalls).toBe(0); // カウントもしない
  });
});
