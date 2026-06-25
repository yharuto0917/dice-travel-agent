import type { PlanDay, TravelPlanDraft } from "@repo/shared";
import { PlanDaySchema } from "@repo/shared";
import { generateObject, generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { Bindings } from "../../env";
import { createLlm } from "../llm/provider";
import { buildSubagents } from "../subagents";
import { buildTools } from "../tools";
import type { ToolContext } from "../tools/context";
import { MAX_STEPS, shouldStopUsageLimit } from "./judgement";
import { DAY_PLANNER_SYSTEM, dayPlannerPrompt } from "./prompts";

export async function runDay(
  env: Bindings,
  ctx: ToolContext,
  plan: TravelPlanDraft,
  n: number,
): Promise<PlanDay> {
  let finalizedDay: PlanDay | null = null;

  const finalizeDay = tool({
    description: "Finalize the day plan and output the complete PlanDay structure.",
    inputSchema: z.object({
      day: PlanDaySchema,
    }),
    execute: async ({ day }) => {
      finalizedDay = day;
      return { success: true, message: "Day finalized successfully." };
    },
  });

  const allTools = {
    ...buildTools(ctx),
    ...buildSubagents(env, ctx),
    finalizeDay,
  };

  // マルチステップのツール呼び出しループを有効化する。AI SDK v6 の generateText は
  // stopWhen を省略すると stepCountIs(1) で 1 ステップ停止し、ツール結果がモデルに
  // 再投入されない（=ツールが事実上使われない）。ステップ数上限に加え、
  // ツール/サブエージェントの使用量上限でも停止させ、コスト暴走を防ぐ。
  const { text } = await generateText({
    model: createLlm(env),
    system: DAY_PLANNER_SYSTEM,
    prompt: dayPlannerPrompt(plan, n, ctx),
    tools: allTools,
    stopWhen: [stepCountIs(MAX_STEPS), () => shouldStopUsageLimit(ctx.usage)],
  });

  // finalizeDay 経由で確定した場合も dayNumber は要求された n に固定する。
  // モデルが別の番号を入れると mergeDay が誤った日を上書きしてしまうため。
  // finalizedDay はクロージャ内でのみ代入されるため TS は初期値 null から型を
  // 広げられない。キャストで宣言型に戻してから truthiness で絞り込む。
  const finalized = finalizedDay as PlanDay | null;
  if (finalized) {
    return { ...finalized, dayNumber: n };
  }

  // フォールバック: finalizeDay が呼ばれなかった場合、計画担当が生成したテキストから
  // PlanDay を構造抽出する。会話履歴は参照できないため text のみを根拠にし、
  // dayNumber は n を強制する。
  const { object } = await generateObject({
    model: createLlm(env),
    schema: PlanDaySchema,
    system:
      "Extract a structured PlanDay for the requested day from the planner's notes. If details are missing, produce a minimal but schema-valid day rather than inventing facts.",
    prompt: `Day number: ${n}\nPlanner notes:\n${text || "(no notes were produced)"}`,
  });

  return { ...object, dayNumber: n };
}
