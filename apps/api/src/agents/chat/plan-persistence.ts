import type { TravelPlan, TravelPlanDraft } from "@repo/shared";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { type PlanRow, plans, planVersions } from "../../db/schema";
import type { Bindings } from "../../env";

/**
 * 計画の版更新を1か所にまとめる（#16 / #20）。
 *
 * 計画生成の finalize（`TravelPlanningAgent`）とチャットからの修正承認
 * （`TravelChatAgent`）の両方から呼ぶ。上書き前に旧版を `plan_versions` へ
 * スナップショットするので、どちらの経路で壊れても `restore` / `diff` で辿れる。
 */
export interface PersistPlanRevisionInput {
  /** 保存する計画本体。 */
  plan: TravelPlan | TravelPlanDraft;
  /** 更新前の計画行。旧版のスナップショットと version の起点に使う。 */
  row: PlanRow;
  /** 保存後の status。省略時は現在の status を維持する。 */
  status?: PlanRow["status"];
  /** スナップショットに付けるラベル（履歴一覧の見出し）。 */
  label?: string;
}

/**
 * 現行計画を新しい版で置き換える。
 *
 * 旧 plan がある場合のみ「旧版を currentVersion で退避 → 新版を +1」とする。
 * 初回確定（旧 plan が null）はスナップショット対象が無いため version を据え置き、
 * 最初の完成プランを version 1 として残す。据え置かないと最初の版が plan_versions に
 * 存在せず diff/履歴から永久に辿れなくなる。
 *
 * @returns 保存後の version 番号。
 */
export async function persistPlanRevision(
  env: Bindings,
  input: PersistPlanRevisionInput,
): Promise<number> {
  const { plan, row, status, label } = input;
  const db = getDb(env);
  const currentVersion = row.version ?? 1;
  const nextVersion = row.plan ? currentVersion + 1 : currentVersion;

  if (row.plan) {
    await db.insert(planVersions).values({
      id: crypto.randomUUID(),
      planId: row.id,
      version: currentVersion,
      plan: row.plan,
      ...(label ? { label } : {}),
    });
  }

  await db
    .update(plans)
    .set({
      plan,
      ...(status ? { status } : {}),
      title: plan.title ?? row.title,
      version: nextVersion,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(plans.id, row.id));

  return nextVersion;
}
