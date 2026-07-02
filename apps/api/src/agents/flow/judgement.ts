import type { ToolContext } from "../tools/context";

export const MAX_STEPS = 8;
/** サブエージェント内部の generateText が回せる最大ステップ数（ツール往復の上限）。 */
export const SUBAGENT_MAX_STEPS = 4;
export const AGENT_MAX_TOOL_CALLS = 12;
export const AGENT_MAX_SUBAGENTS = 5;
/** HITL の回答待ちタイムアウト（秒）。期限到来で該当質問を skip し再開する（#15）。 */
export const HITL_TIMEOUT_SEC = 180;
/**
 * 1プラン全体での HITL 質問の上限（#47）。曖昧な分岐では積極的に確認する一方、
 * 質問過多を防ぐため総数を制限する。上限到達後は humanInTheLoop が発火しても
 * 質問を積まず、モデルへ「自分の判断で進める」よう返す（決定的に強制する）。
 */
export const MAX_HITL_QUESTIONS = 3;
/** finalize 時の JSON 修復（generateObject）の最大試行回数（#16）。 */
export const FIX_MAX_ATTEMPTS = 2;

export function createUsageCounter(): ToolContext["usage"] {
  return {
    toolCalls: 0,
    subagents: 0,
    tool() {
      this.toolCalls++;
    },
    subagent() {
      this.subagents++;
    },
    generateImage() {
      // track image generation
    },
  };
}

export function shouldStopUsageLimit(usage: ToolContext["usage"]) {
  return usage.toolCalls >= AGENT_MAX_TOOL_CALLS || usage.subagents >= AGENT_MAX_SUBAGENTS;
}
