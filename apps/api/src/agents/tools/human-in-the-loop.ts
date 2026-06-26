import { tool } from "ai";
import { z } from "zod";
import { makeQuestion } from "../hitl/questions";
import type { ToolContext } from "./context";

/** ツール結果として返すセンチネル。オーケストレータはこの呼び出しで停止する。 */
export const HITL_PENDING = "HITL_PENDING";

/**
 * Human-in-the-loop ツール。本質的な情報が曖昧で安全に進められないときだけ
 * 1 回呼び、ユーザーへ質問する。execute は質問を ctx.hitl.pending に積み、
 * `stopWhen` 述語（pending.length>0）が即座にループを止める。
 */
export function buildHumanInTheLoop(ctx: ToolContext) {
  return tool({
    description:
      "Ask the user a clarifying question ONLY when essential information is ambiguous or missing and you cannot proceed safely. Use sparingly: a single concise question, with options when applicable. Do not use for trivial decisions.",
    inputSchema: z.object({
      question: z.string().describe("A concise question for the user"),
      options: z.array(z.string()).optional().describe("Optional choices to present"),
    }),
    execute: async ({ question, options }) => {
      ctx.usage.tool();
      const q = makeQuestion(question, options);
      ctx.hitl.pending.push(q);
      return { status: HITL_PENDING, questionId: q.id };
    },
  });
}
