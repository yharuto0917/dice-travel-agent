"use client";

import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import type { GetPlanResponse } from "@repo/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardBody } from "@/components/ui/card";
import { PLAN_ITEM_LABELS } from "@/lib/agent";
import { getPlan, resolveAssetUrl } from "@/lib/api";

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
      <div className="flex flex-1 flex-col gap-4">
        {plan?.title ? <h1 className="text-xl font-extrabold">{plan.title}</h1> : null}
        {plan?.summary ? (
          <p className="text-sm leading-relaxed text-muted">{plan.summary}</p>
        ) : null}

        {plan?.days?.map((day) => (
          <Card key={day.dayNumber}>
            <CardBody className="flex flex-col gap-3">
              <p className="text-base font-bold">{day.title ?? `${day.dayNumber}日目`}</p>
              <ul className="flex flex-col gap-2">
                {day.items.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 inline-flex shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[0.65rem] font-bold text-primary">
                      {PLAN_ITEM_LABELS[item.type]}
                    </span>
                    <span className="min-w-0">
                      {item.startTime ? (
                        <span className="mr-1 font-bold text-foreground">{item.startTime}</span>
                      ) : null}
                      <span className="font-bold text-foreground">{item.title}</span>
                      {item.description ? (
                        <span className="mt-0.5 block text-muted">{item.description}</span>
                      ) : null}
                      {item.image?.url ? (
                        <div className="mt-2 max-w-md overflow-hidden rounded-lg">
                          <img
                            src={resolveAssetUrl(item.image.url)}
                            alt={item.title}
                            className="aspect-square w-full object-cover"
                          />
                        </div>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}

        {plan?.budget?.total ? (
          <p className="text-right text-sm font-bold">
            予算の目安: 約 {plan.budget.total.amount.toLocaleString()} 円
          </p>
        ) : null}

        {!plan?.days?.length ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">
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
