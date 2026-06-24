import type { ToolContext } from "../tools/context";

export const MAX_STEPS = 8;
export const AGENT_MAX_TOOL_CALLS = 12;
export const AGENT_MAX_SUBAGENTS = 5;

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
  };
}

export function shouldStopUsageLimit(usage: ToolContext["usage"]) {
  return usage.toolCalls >= AGENT_MAX_TOOL_CALLS || usage.subagents >= AGENT_MAX_SUBAGENTS;
}
