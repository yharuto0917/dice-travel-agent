import { type GeoPoint, prefectureCentroid, type TravelPlan } from "@repo/shared";
import { createClients } from "../../clients";
import type { PlanRow } from "../../db/schema";
import type { Bindings } from "../../env";
import { createUsageCounter } from "../flow/judgement";
import type { ToolContext } from "../tools/context";

/**
 * 常駐チャット（#20）のツール実行コンテキストを組み立てる。
 *
 * 検索系ツール（`buildTools`）は計画生成と同じ {@link ToolContext} を要求するため、
 * ここで chat 用に一式を用意する。計画生成と違い会話は1ターンで完結するので、
 * 使用量カウンタはターンごとに新規で作る。
 *
 * 目的地の座標はジオコーディングを呼ばず、確定済み計画の `destination.location` を使う。
 * completed な計画は必ずこの値を持ち、無い場合も県庁所在地の代表点へ落とせるため、
 * 会話のたびに外部APIを叩く必要がない。
 */
export function createChatToolContext(env: Bindings, row: PlanRow, plan: TravelPlan): ToolContext {
  const destPoint: GeoPoint | null =
    plan.destination?.location ?? prefectureCentroid(row.destinationPrefCode);

  return {
    env,
    clients: createClients(env),
    destPoint,
    conditions: plan.conditions ?? row.conditions ?? {},
    usage: createUsageCounter(),
    // チャットでは HITL を使わない（確認したいことは会話でそのまま聞けばよい）。
    // ToolContext の必須項目なので空のコレクタを渡す。
    hitl: { pending: [], answers: {}, askedCount: 0 },
  };
}
