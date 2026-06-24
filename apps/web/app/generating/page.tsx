"use client";

import { ArrowRight, CheckCircle, Sparkle, WarningCircle } from "@phosphor-icons/react";
import type { AgentState } from "@repo/shared";
import { useAgent } from "agents/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { AGENT_HOST, PHASE_LABELS, PLAN_ITEM_LABELS, TRAVEL_AGENT_NAME } from "@/lib/agent";
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

            {/* 充填済みセクション */}
            {state && state.filledSections.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {state.filledSections.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-[0.7rem] font-bold text-primary"
                  >
                    <CheckCircle size={12} weight="fill" />
                    {s}
                  </span>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>

        {/* HITL: 確認待ちの質問（#13 は足場。通常フローでは表示されない） */}
        {pendingQuestions.length > 0 ? (
          <div className="mt-4 flex flex-col gap-3">
            {pendingQuestions.map((q) => (
              <HitlQuestionCard
                key={q.id}
                question={q.question}
                options={q.options}
                onAnswer={(answer) => void agent.stub.answerQuestion(q.id, answer)}
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

/** HITL 質問1件の回答 UI（足場）。 */
function HitlQuestionCard({
  question,
  options,
  onAnswer,
}: {
  question: string;
  options?: string[];
  onAnswer: (answer: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm font-bold">{question}</p>
        {options && options.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {options.map((opt) => (
              <Button key={opt} size="sm" variant="outline" onClick={() => onAnswer(opt)}>
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
              className="flex-1 rounded-xl border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="回答を入力"
            />
            <Button size="sm" onClick={() => text.trim() && onAnswer(text.trim())}>
              回答
            </Button>
          </div>
        )}
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
