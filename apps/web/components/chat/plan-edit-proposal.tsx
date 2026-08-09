"use client";

import { CheckCircle, XCircle } from "@phosphor-icons/react";
import type { PendingPlanEdit } from "@repo/shared";
import { Button } from "@/components/ui/button";
import { DIFF_CHANGE_CLASSES, DIFF_CHANGE_LABELS } from "@/lib/agent";
import { cn } from "@/lib/utils";

/**
 * チャット由来の計画修正提案の差分プレビュー（#20）。
 *
 * 承認するまで計画は書き換わらない。何が変わるのかを日・予定の粒度で先に見せ、
 * 「反映する」を押して初めて D1 の現行計画が差し替わる。
 */
export function PlanEditProposal({
  edit,
  onApply,
  onReject,
  applying = false,
}: {
  edit: PendingPlanEdit;
  onApply: () => void;
  onReject: () => void;
  /** 適用中（連打防止）。 */
  applying?: boolean;
}) {
  // 変更のあった日だけを見せる。全日を並べると差分が埋もれる。
  const changedDays = edit.diff.days.filter((day) => day.change !== "unchanged");

  return (
    <section
      aria-label="計画の修正案"
      className="rounded-2xl border-2 border-line bg-surface-2/60 p-3.5 shadow-toy"
    >
      <p className="text-sm font-extrabold">{edit.summary}</p>

      <div className="mt-2.5 flex flex-col gap-2">
        {edit.diff.titleChanged ? <ChangeNote label="タイトル" /> : null}
        {edit.diff.summaryChanged ? <ChangeNote label="概要" /> : null}
        {edit.diff.budgetChanged ? <ChangeNote label="予算" /> : null}

        {changedDays.map((day) => {
          const items = day.items.filter((item) => item.change !== "unchanged");
          return (
            <div key={day.dayNumber} className="rounded-xl border border-line/60 bg-surface p-2.5">
              <p className="text-xs font-extrabold">
                {day.dayNumber}日目
                <span
                  className={cn(
                    "ml-1.5 rounded-full px-1.5 py-0.5 text-[0.65rem] font-bold",
                    DIFF_CHANGE_CLASSES[day.change],
                  )}
                >
                  {DIFF_CHANGE_LABELS[day.change]}
                </span>
              </p>
              {items.length > 0 ? (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {items.map((item) => (
                    <li
                      key={`${item.change}-${item.title}`}
                      className="flex items-start gap-1.5 text-xs"
                    >
                      <span
                        className={cn(
                          "mt-px shrink-0 rounded-full px-1.5 py-0.5 text-[0.65rem] font-bold",
                          DIFF_CHANGE_CLASSES[item.change],
                        )}
                      >
                        {DIFF_CHANGE_LABELS[item.change]}
                      </span>
                      <span className="min-w-0 break-words">{item.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted">予定の増減はありません</p>
              )}
            </div>
          );
        })}

        {changedDays.length === 0 &&
        !edit.diff.titleChanged &&
        !edit.diff.summaryChanged &&
        !edit.diff.budgetChanged ? (
          <p className="text-xs text-muted">現在の計画との違いはありませんでした。</p>
        ) : null}
      </div>

      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1" onClick={onApply} disabled={applying}>
          <CheckCircle size={16} weight="fill" />
          反映する
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={onReject}
          disabled={applying}
        >
          <XCircle size={16} weight="fill" />
          取り消す
        </Button>
      </div>
    </section>
  );
}

/** 日単位ではない変更（タイトル・概要・予算）の1行表示。 */
function ChangeNote({ label }: { label: string }) {
  return (
    <p className="text-xs font-bold text-muted">
      <span className="mr-1.5 rounded-full bg-accent/20 px-1.5 py-0.5 text-[0.65rem] text-accent-foreground">
        変更
      </span>
      {label}
    </p>
  );
}
