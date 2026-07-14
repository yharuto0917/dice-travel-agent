"use client";

import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import type { GetPlanResponse } from "@repo/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BudgetPage } from "@/components/itinerary/BudgetPage";
import { CoverPage } from "@/components/itinerary/CoverPage";
import { DayPage } from "@/components/itinerary/DayPage";
import { AppShell } from "@/components/layout/app-shell";
import { getPlan } from "@/lib/api";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: GetPlanResponse };

function ItineraryInner({ planId }: { planId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getPlan(planId)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((e) => {
        if (!cancelled) setState({ status: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [planId]);

  if (state.status === "loading") {
    return (
      <AppShell title="旅のしおり" back={{ href: "/" }}>
        <div className="flex flex-1 items-center justify-center text-sm text-muted">
          <ArrowClockwise size={20} className="mr-2 animate-spin" />
          読み込んでいます…
        </div>
      </AppShell>
    );
  }

  if (state.status === "error") {
    return (
      <AppShell title="旅のしおり" back={{ href: "/" }}>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-red-500">
          <WarningCircle size={28} weight="fill" />
          計画を読み込めませんでした
        </div>
      </AppShell>
    );
  }

  const plan = state.data.plan;

  return (
    <AppShell title="旅のしおり" back={{ href: "/" }}>
      <div className="w-full max-w-3xl mx-auto py-6 sm:py-10 px-2 sm:px-4">
        <div className="bg-paper border-y-2 border-line sm:border-2 sm:rounded-3xl shadow-toy-lg relative overflow-hidden flex flex-col">
          {/* Red vertical margin line for the whole notebook */}
          <div className="absolute left-6 md:left-10 top-0 bottom-0 w-[2px] bg-red-300/60 z-0 pointer-events-none" />

          {/* Lined paper background pattern */}
          <div
            className="absolute inset-0 pointer-events-none z-0 opacity-50"
            style={{
              backgroundImage:
                "repeating-linear-gradient(transparent, transparent 31px, var(--color-line) 31px, var(--color-line) 32px)",
              backgroundAttachment: "local",
              opacity: 0.1,
            }}
          />

          {/* Masking tape on top to look attached to a board */}
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-48 h-10 masking-tape rotate-[-1deg] z-20" />

          <div className="relative z-10 flex flex-col">
            {plan ? (
              <div className="pb-10 border-b-2 border-dashed border-line/20">
                <CoverPage plan={plan} />
              </div>
            ) : null}

            <div className="flex flex-col">
              {plan?.days?.map((day, i) => (
                <div
                  key={day.dayNumber}
                  className={
                    i !== (plan.days?.length ?? 1) - 1
                      ? "border-b-2 border-dashed border-line/20"
                      : ""
                  }
                >
                  <DayPage day={day} />
                </div>
              ))}
            </div>

            {plan?.budget?.total ? (
              <div className="border-t-2 border-dashed border-line/20">
                <BudgetPage budget={plan.budget} />
              </div>
            ) : null}

            {!plan?.days?.length ? (
              <div className="flex items-center justify-center text-sm text-muted h-40">
                まだ予定がありません
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/** planId を解決し、無ければ最初の画面へ戻す。 */
function ItineraryGate() {
  const router = useRouter();
  const planId = useSearchParams().get("planId");

  useEffect(() => {
    if (!planId) router.replace("/");
  }, [planId, router]);

  if (!planId) return null;
  return <ItineraryInner planId={planId} />;
}

export default function ItineraryPage() {
  return (
    <Suspense fallback={null}>
      <ItineraryGate />
    </Suspense>
  );
}
