import type { GeoPoint, HitlQuestion, TripConditions as PlanConditions } from "@repo/shared";
import type { createClients } from "../../clients";
import type { Bindings } from "../../env";

export interface UsageCounter {
  toolCalls: number;
  subagents: number;
  tool: () => void;
  subagent: () => void;
}

/**
 * `generateItemImage` が生成した画像（#18）。R2 配信URL と主題（alt に使う）を保持する。
 * 日の構造化後に orchestrator が各アイテムへ**決定的に**生成・添付する際の受け渡し型。
 */
export interface GeneratedImage {
  /** R2 配信URL（例: https://<api>/assets/generated/<uuid>.png）。 */
  url: string;
  /** 生成の元になった主題（alt テキストに使う）。 */
  prompt: string;
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
