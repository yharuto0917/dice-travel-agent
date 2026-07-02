import type { GeoPoint, HitlQuestion, TripConditions as PlanConditions } from "@repo/shared";
import type { createClients } from "../../clients";
import type { Bindings } from "../../env";

export interface UsageCounter {
  toolCalls: number;
  subagents: number;
  tool: () => void;
  subagent: () => void;
  generateImage: () => void;
}

/**
 * HITL コレクタ。`humanInTheLoop` ツールが pending に質問を積み、
 * オーケストレータが `pending.length>0` でループを停止する。
 * `answers` は再開時に既回答の Q&A をプロンプトへ反映するためのマップ。
 */
export interface HitlCollector {
  pending: HitlQuestion[];
  answers: Record<string, string>;
  /**
   * これまでに（過去の日も含め）ユーザーへ提示済みの質問総数（#47）。
   * humanInTheLoop が上限（MAX_HITL_QUESTIONS）を超えないか判定するために使う。
   */
  askedCount: number;
}

export interface ToolContext {
  env: Bindings;
  clients: ReturnType<typeof createClients>;
  destPoint: GeoPoint | null;
  conditions: Partial<PlanConditions>;
  usage: UsageCounter;
  hitl: HitlCollector;
}
