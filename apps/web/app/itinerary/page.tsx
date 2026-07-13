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
      <div className="flex flex-1 flex-col gap-8 max-w-2xl mx-auto w-full">
        {plan ? (
          <div className="bg-paper border-y-2 border-line sm:border-2 sm:rounded-3xl shadow-toy overflow-hidden aspect-[3/4] max-h-[80vh]">
            <CoverPage plan={plan} />
          </div>
        ) : null}

        <div className="flex flex-col gap-12">
          {plan?.days?.map((day) => (
            <div
              key={day.dayNumber}
              className="bg-paper border-y-2 border-line sm:border-2 sm:rounded-3xl shadow-toy overflow-hidden min-h-[50vh]"
            >
              <DayPage day={day} />
            </div>
          ))}
        </div>

        {plan?.budget?.total ? (
          <div className="bg-paper border-y-2 border-line sm:border-2 sm:rounded-3xl shadow-toy overflow-hidden min-h-[40vh]">
            <BudgetPage budget={plan.budget} />
          </div>
        ) : null}

        {!plan?.days?.length ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted min-h-[20vh] border-2 border-dashed border-line rounded-xl">
            まだ予定がありません
          </div>
        ) : null}
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
