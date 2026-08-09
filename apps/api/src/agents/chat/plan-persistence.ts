import type { TravelPlan, TravelPlanDraft } from "@repo/shared";
import type { PlanRow } from "../../db/schema";
import type { Bindings } from "../../env";

/** 読み出した version が既に更新され、CAS に失敗したことを表す。 */
export class PlanRevisionConflictError extends Error {
  constructor() {
    super("plan revision conflict");
    this.name = "PlanRevisionConflictError";
  }
}

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
  const currentVersion = row.version ?? 1;
  const nextVersion = row.plan ? currentVersion + 1 : currentVersion;
  const now = new Date().toISOString();
  const nextStatus = status ?? row.status;
  const nextTitle = plan.title ?? row.title ?? null;
  const serializedPlan = JSON.stringify(plan);

  if (row.plan) {
    const snapshotId = crypto.randomUUID();
    // D1 batch は全ステートメントを1トランザクションで逐次実行する。
    // snapshot は入力 row の JSON ではなく、その瞬間の plans 行から SELECT する。
    // UPDATE 側も snapshotId の存在と currentVersion を条件にするため、CAS 敗者は
    // snapshot も現行更新も 0 件となり、中途半端な履歴を残さない。
    const [, updated] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO plan_versions (id, plan_id, version, plan, label, created_at)
         SELECT ?, id, version, plan, ?, ?
         FROM plans
         WHERE id = ? AND version = ? AND plan IS NOT NULL`,
      ).bind(snapshotId, label ?? null, now, row.id, currentVersion),
      env.DB.prepare(
        `UPDATE plans
         SET plan = ?, status = ?, title = ?, version = ?, updated_at = ?
         WHERE id = ? AND version = ?
           AND EXISTS (SELECT 1 FROM plan_versions WHERE id = ?)`,
      ).bind(
        serializedPlan,
        nextStatus,
        nextTitle,
        nextVersion,
        now,
        row.id,
        currentVersion,
        snapshotId,
      ),
    ]);
    if (updated?.meta.changes !== 1) throw new PlanRevisionConflictError();
    return nextVersion;
  }

  // 初回確定も version と plan IS NULL の両方で CAS する。同じ version 1 を読んだ
  // 別処理が先に完成 plan を保存していれば、後勝ちで消さず競合として返す。
  const updated = await env.DB.prepare(
    `UPDATE plans
     SET plan = ?, status = ?, title = ?, version = ?, updated_at = ?
     WHERE id = ? AND version = ? AND plan IS NULL`,
  )
    .bind(serializedPlan, nextStatus, nextTitle, nextVersion, now, row.id, currentVersion)
    .run();
  if (updated.meta.changes !== 1) throw new PlanRevisionConflictError();

  return nextVersion;
}
