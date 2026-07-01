import type { Bindings } from "../../env";
import type { ToolContext } from "../tools/context";
import { buildEnhancementSubagent } from "./enhancement";
import { buildFactcheckSubagent } from "./factcheck";
import { buildResearchSubagent } from "./research";
import { buildSummarizeSubagent } from "./summarize";

export function buildSubagents(env: Bindings, ctx: ToolContext) {
  return {
    research: buildResearchSubagent(env, ctx),
    enhancement: buildEnhancementSubagent(env, ctx),
    factcheck: buildFactcheckSubagent(env, ctx),
    summarize: buildSummarizeSubagent(env, ctx),
  };
}
