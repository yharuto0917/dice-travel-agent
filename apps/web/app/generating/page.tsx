"use client";

import { ArrowRight, CheckCircle, Sparkle, WarningCircle } from "@phosphor-icons/react";
import type { AgentState, TimelineEvent } from "@repo/shared";
import { useAgent } from "agents/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { AppShell } from "@/components/layout/app-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import {
  AGENT_HOST,
  PHASE_LABELS,
  PLAN_ITEM_LABELS,
  SECTION_LABELS,
  TIMELINE_KIND_ICON,
  TRAVEL_AGENT_NAME,
} from "@/lib/agent";
import { FLOW_STEPS } from "@/lib/flow";
import { cn } from "@/lib/utils";

const STEP_INDEX = 3; // 計画作成中（4ステップ目）

function GeneratingInner({ planId }: { planId: string }) {
  // Agent の state は onStateUpdate で受け取り、ローカルに反映して再描画する。
  const [state, setState] = useState<AgentState | null>(null);
  const startedRef = useRef(false);

  const agent = useAgent<AgentState>({
    agent: TRAVEL_AGENT_NAME,
    name: planId,
    host: AGENT_HOST,
    onStateUpdate: (next) => setState(next),
  });

  // 接続が確立したら一度だけ生成を開始する（Agent 側も冪等）。
  useEffect(() => {
    let cancelled = false;
    agent.ready
      .then(() => {
        if (cancelled || startedRef.current) return;
        startedRef.current = true;
        void agent.stub.start();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agent]);

  const phase = state?.phase ?? "idle";
  const progress = state?.progress ?? 0;
  const plan = state?.plan;
  const pendingQuestions = (state?.questions ?? []).filter((q) => q.status === "pending");
  const isDone = phase === "done";
  const isError = phase === "error";

  return (
    <AppShell title="計画作成中" back={{ href: "/conditions" }}>
      <div className="flex flex-1 flex-col">
        {/* 進捗ステッパー */}
        <ol className="flex items-center gap-1.5">
          {FLOW_STEPS.map((s, i) => (
            <li
              key={s.slug}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                i <= STEP_INDEX ? "bg-primary" : "bg-surface-2",
              )}
            />
          ))}
        </ol>
        <p className="mt-3 text-xs font-bold tracking-wide text-muted">
          STEP {String(STEP_INDEX + 1).padStart(2, "0")} /{" "}
          {String(FLOW_STEPS.length).padStart(2, "0")}
        </p>

        {/* 現在フェーズ＋進捗バー */}
        <Card className="mt-4">
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-pip",
                  isError ? "bg-red-500/15 text-red-500" : "bg-surface-2 text-primary",
                )}
              >
                {isDone ? (
                  <CheckCircle size={28} weight="fill" />
                ) : isError ? (
                  <WarningCircle size={28} weight="fill" />
                ) : (
                  <Sparkle size={28} weight="duotone" className="animate-pulse" />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-extrabold">{PHASE_LABELS[phase]}</p>
                {isError && state?.error ? (
                  <p className="mt-0.5 truncate text-xs text-red-500">{state.error}</p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted">{Math.round(progress * 100)}% 完了</p>
                )}
              </div>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  isError ? "bg-red-500" : "bg-primary",
                )}
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>

            {/* 現在の実行状況（一行）。思考の途中経過も含む詳細は下の実行履歴に流れる。 */}
            {!isDone && !isError && state?.activity ? (
              <div className="flex items-center gap-2 text-xs font-bold text-muted">
                <span className="inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
                <span className="truncate">{state.activity}</span>
              </div>
            ) : null}

            {/* 充填済みセクション */}
            {state && state.filledSections.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {state.filledSections.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-[0.7rem] font-bold text-primary"
                  >
                    <CheckCircle size={12} weight="fill" />
                    {SECTION_LABELS[s] ?? s}
                  </span>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>

        {/* 実行履歴タイムライン（#47 可観測性）。生成中も完了後も「何をしたか」を振り返れる。 */}
        {state && state.timeline.length > 0 ? <Timeline events={state.timeline} /> : null}

        {/* HITL: 確認待ちの質問（#13 は足場。通常フローでは表示されない） */}
        {pendingQuestions.length > 0 ? (
          <div className="mt-4 flex flex-col gap-3">
            {pendingQuestions.map((q) => (
              <HitlQuestionCard
                key={q.id}
                question={q.question}
                options={q.options}
                onAnswer={(answer) => void agent.stub.answerQuestion(q.id, answer)}
                onSkip={() => void agent.stub.skipQuestion(q.id)}
              />
            ))}
          </div>
        ) : null}

        {/* 計画ドラフトのライブプレビュー */}
        {plan ? <PlanPreview plan={plan} /> : null}

        {/* 完了 / エラー時のアクション */}
        <div className="mt-auto pt-8">
          {isDone ? (
            <Link
              href={`/itinerary?planId=${planId}`}
              className={cn(buttonVariants({ size: "lg" }), "w-full")}
            >
              旅のしおりを見る
              <ArrowRight size={18} weight="bold" />
            </Link>
          ) : isError ? (
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              onClick={() => {
                startedRef.current = false;
                void agent.stub.start();
              }}
            >
              もう一度試す
            </Button>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

/** start/done を groupId でまとめた表示用の1行。 */
type TimelineRow = {
  key: string;
  kind: TimelineEvent["kind"];
  label: string;
  status: TimelineEvent["status"];
  detail: string | null;
  dayNumber: number | null;
};

/**
 * 履歴イベントを groupId でまとめる。同一 groupId の start→done は1行に集約し、
 * 最後に来た状態（done/error）で上書きする。groupId が無い単発イベントは id をキーに1行。
 */
function buildRows(events: TimelineEvent[]): TimelineRow[] {
  const rows = new Map<string, TimelineRow>();
  const order: string[] = [];
  for (const e of events) {
    const key = e.groupId ?? e.id;
    const existing = rows.get(key);
    if (existing) {
      existing.status = e.status;
      existing.label = e.label;
      if (e.detail) existing.detail = e.detail;
    } else {
      rows.set(key, {
        key,
        kind: e.kind,
        label: e.label,
        status: e.status,
        detail: e.detail,
        dayNumber: e.dayNumber,
      });
      order.push(key);
    }
  }
  return order.map((k) => rows.get(k) as TimelineRow);
}

/** 実行履歴タイムライン。ツール・サブエージェント・フェーズ・思考・確認の流れを時系列で表示する。 */
function Timeline({ events }: { events: TimelineEvent[] }) {
  // events は毎レンダーで再構築されうるため、行の集約はメモ化する（最大200件の再計算回避）。
  const rows = useMemo(() => buildRows(events), [events]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // detail を持つ行（終わった思考・サブエージェント結果）は既定で折りたたみ、クリックで開く。
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());

  const toggle = (key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 新しいイベントが来たら末尾（最新）へ自動スクロールする。
  useEffect(() => {
    const el = scrollRef.current;
    if (el && events.length > 0) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <Card className="mt-4">
      <CardBody className="flex flex-col gap-2">
        <p className="text-xs font-extrabold tracking-wide text-muted">実行履歴</p>
        <div ref={scrollRef} className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
          {rows.map((row) => {
            const hasDetail = !!row.detail;
            const isOpen = openKeys.has(row.key);
            // 進行中の思考はライブ表示（detail を即表示、トグル不要）。
            const isLive = row.kind === "thinking" && row.status === "start" && hasDetail;
            return (
              <div key={row.key} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 shrink-0 leading-none">{TIMELINE_KIND_ICON[row.kind]}</span>
                {/* ステータス印は 13px 角の枠に揃える。進行中のドットは小さいので枠の中央に
                    置き、完了/失敗アイコン（13px）と中心位置を一致させる（ズレ防止）。 */}
                <span className="mt-0.5 flex h-[13px] w-[13px] shrink-0 items-center justify-center">
                  {row.status === "start" ? (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                  ) : row.status === "error" ? (
                    <WarningCircle size={13} weight="fill" className="text-red-500" />
                  ) : (
                    <CheckCircle size={13} weight="fill" className="text-primary" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  {/* 生成中の思考は detail をライブ表示（クリック不要）。終わった思考・サブ
                      エージェント結果は detail をトグルで開閉する。 */}
                  {hasDetail && !isLive ? (
                    <button
                      type="button"
                      onClick={() => toggle(row.key)}
                      className="flex w-full items-center gap-1 text-left"
                      aria-expanded={isOpen}
                    >
                      <span className="font-bold text-foreground/90">
                        {row.dayNumber ? (
                          <span className="mr-1 text-muted">[{row.dayNumber}日目]</span>
                        ) : null}
                        {row.label}
                      </span>
                      <span className="shrink-0 text-[0.65rem] font-bold text-primary/80">
                        {isOpen ? "閉じる" : row.kind === "thinking" ? "思考を見る" : "詳細"}
                      </span>
                    </button>
                  ) : (
                    <p className="font-bold text-foreground/90">
                      {row.dayNumber ? (
                        <span className="mr-1 text-muted">[{row.dayNumber}日目]</span>
                      ) : null}
                      {row.label}
                    </p>
                  )}
                  {/* ライブ思考は流れ込むストリームを Streamdown で Markdown 整形（未完の
                      ブロックも崩れず描画）。ライブ中は高さを抑えて末尾まで流し込み、確定済みは
                      展開時に全文表示する。 */}
                  {row.detail && (isLive || isOpen) ? (
                    <div
                      className={cn(
                        "mt-1 rounded-lg bg-surface-2/60 px-2.5 py-1.5 text-[0.68rem] leading-relaxed text-muted/90",
                        isLive ? "max-h-16 overflow-hidden" : null,
                      )}
                    >
                      <Streamdown
                        parseIncompleteMarkdown={isLive}
                        className={cn(
                          // 小さな思考ボックス向けにブロック間マージンを詰めて密度を上げる。
                          "[&_:first-child]:mt-0 [&_:last-child]:mb-0",
                          "[&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5",
                          "[&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4",
                          "[&_h1]:my-1 [&_h2]:my-1 [&_h3]:my-1 [&_h1]:text-[0.75rem] [&_h2]:text-[0.72rem] [&_h3]:text-[0.7rem] [&_:is(h1,h2,h3)]:font-bold",
                          "[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.64rem]",
                          "[&_a]:text-primary [&_a]:underline [&_strong]:font-bold",
                        )}
                      >
                        {row.detail}
                      </Streamdown>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

/** 計画ドラフトの要約プレビュー。 */
function PlanPreview({ plan }: { plan: NonNullable<AgentState["plan"]> }) {
  if (!plan.title && !plan.days?.length) return null;

  return (
    <Card className="mt-4">
      <CardBody className="flex flex-col gap-4">
        {plan.title ? <h2 className="text-lg font-extrabold">{plan.title}</h2> : null}
        {plan.summary ? <p className="text-sm leading-relaxed text-muted">{plan.summary}</p> : null}

        {plan.days?.map((day) => (
          <div
            key={day.dayNumber}
            className="rounded-2xl border border-line/60 bg-surface-2/50 p-3"
          >
            <p className="text-sm font-bold">{day.title ?? `${day.dayNumber}日目`}</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {day.items.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-sm">
                  <span className="inline-flex shrink-0 rounded-full bg-surface px-2 py-0.5 text-[0.65rem] font-bold text-primary">
                    {PLAN_ITEM_LABELS[item.type]}
                  </span>
                  <span className="truncate text-foreground">{item.title}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {plan.budget?.total ? (
          <p className="text-right text-sm font-bold">
            予算の目安: 約 {plan.budget.total.amount.toLocaleString()} 円
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** HITL 質問1件の回答 UI。回答・選択・スキップに対応する。 */
function HitlQuestionCard({
  question,
  options,
  onAnswer,
  onSkip,
}: {
  question: string;
  options?: string[];
  onAnswer: (answer: string) => void;
  onSkip: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm font-bold break-words">{question}</p>
        {options && options.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {options.map((opt) => (
              <Button
                key={opt}
                size="sm"
                variant="outline"
                onClick={() => onAnswer(opt)}
                // 長い選択肢でもカード幅を超えないよう、固定高さを解いて折り返す。
                className="h-auto max-w-full whitespace-normal py-1.5 text-left break-words"
              >
                {opt}
              </Button>
            ))}
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              // min-w-0 が無いと flex-1 の入力欄が縮まず、長い入力で回答ボタンを押し出す。
              className="min-w-0 flex-1 rounded-xl border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="回答を入力"
            />
            <Button
              size="sm"
              className="shrink-0"
              onClick={() => text.trim() && onAnswer(text.trim())}
            >
              回答
            </Button>
          </div>
        )}
        {/* 回答せず進める（サーバ側はタイムアウトでも自動スキップする）。 */}
        <button
          type="button"
          onClick={onSkip}
          className="self-start text-xs font-bold text-muted underline-offset-2 hover:underline"
        >
          スキップして進める
        </button>
      </CardBody>
    </Card>
  );
}

/** planId を解決し、無ければ最初の画面へ戻す。 */
function GeneratingGate() {
  const router = useRouter();
  const planId = useSearchParams().get("planId");

  useEffect(() => {
    if (!planId) router.replace("/destination");
  }, [planId, router]);

  if (!planId) return null;
  return <GeneratingInner planId={planId} />;
}

export default function GeneratingPage() {
  return (
    <Suspense fallback={null}>
      <GeneratingGate />
    </Suspense>
  );
}
