import type { GeoPoint, TripConditions as PlanConditions } from "@repo/shared";
import type { createClients } from "../../clients";

export interface UsageCounter {
  toolCalls: number;
  subagents: number;
  tool: () => void;
  subagent: () => void;
}

export interface ToolContext {
  clients: ReturnType<typeof createClients>;
  destPoint: GeoPoint | null;
  conditions: Partial<PlanConditions>;
  usage: UsageCounter;
}
