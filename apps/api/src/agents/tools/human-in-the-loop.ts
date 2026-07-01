import { tool } from "ai";
import { z } from "zod";
import { MAX_HITL_QUESTIONS } from "../flow/judgement";
import { makeQuestion } from "../hitl/questions";
import type { ToolContext } from "./context";

/** ツール結果として返すセンチネル。オーケストレータはこの呼び出しで停止する。 */
export const HITL_PENDING = "HITL_PENDING";
/** 上限到達でこれ以上質問を積めないときに返すセンチネル（モデルは自分の判断で続行する）。 */
export const HITL_LIMIT_REACHED = "HITL_LIMIT_REACHED";

/**
 * Human-in-the-loop ツール（#47 で積極採用へ方針変更）。
 * 曖昧な条件・複数の有力候補・前提の欠落など「ユーザーの好みで結果が大きく変わる分岐」では
 * 既定値で押し切らず確認する。ただし質問過多を防ぐため、1プラン全体の質問数を
 * `MAX_HITL_QUESTIONS` に制限する。上限到達後は質問を積まず、HITL_LIMIT_REACHED を返して
 * モデルに自分の判断で進めさせる（停止しない）。
 *
 * execute は質問を ctx.hitl.pending に積み、`stopWhen` 述語（pending.length>0）が
 * 即座にループを止める。
 */
export function buildHumanInTheLoop(ctx: ToolContext) {
  return tool({
    description:
      "Ask the user a clarifying question when a choice would meaningfully change the plan and the user's preference is unknown — e.g. ambiguous conditions, multiple strong candidates, or a missing assumption. Prefer asking over silently guessing on such branches. Keep it to a single concise question with options when applicable, and do not re-ask anything already answered. Avoid trivial questions.",
    inputSchema: z.object({
      question: z.string().describe("A concise question for the user"),
      options: z.array(z.string()).optional().describe("Optional choices to present"),
    }),
    execute: async ({ question, options }) => {
      // 上限（過去質問 + 当ループの pending）に達していれば、これ以上は積まず続行させる。
      if (ctx.hitl.askedCount + ctx.hitl.pending.length >= MAX_HITL_QUESTIONS) {
        return {
          status: HITL_LIMIT_REACHED,
          message:
            "確認の上限に達しました。これ以上ユーザーに質問せず、これまでの情報と妥当な既定値であなたの判断で計画を進めてください。",
        };
      }
      ctx.usage.tool();
      const q = makeQuestion(question, options);
      ctx.hitl.pending.push(q);
      return { status: HITL_PENDING, questionId: q.id };
    },
  });
}
