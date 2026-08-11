"use client";

import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import type { GetPlanResponse } from "@repo/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ChatAccessGate } from "@/components/chat/chat-access-gate";
import { ChatDock } from "@/components/chat/chat-dock";
import { TravelChat } from "@/components/chat/travel-chat";
import { BudgetPage } from "@/components/itinerary/BudgetPage";
import { CoverPage } from "@/components/itinerary/CoverPage";
import { DayPage } from "@/components/itinerary/DayPage";
import { PrintButton } from "@/components/itinerary/print-button";
import { AppShell } from "@/components/layout/app-shell";
import { getPlan } from "@/lib/api";
import { clearChatAccess, loadChatAccess } from "@/lib/chat-access-token";
import { useTravelChat } from "@/lib/hooks/use-travel-chat";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: GetPlanResponse };

function ItineraryInner({ planId }: { planId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // 常駐チャットの接続許可。token 本体は HttpOnly Cookie、ここは期限内かの UI 状態だけ。
  // 生成直後は conditions 画面が保存済み、
  // それ以外（履歴・URL 直開き・期限切れ）は ChatAccessGate で取り直す。
  const [chatAccessReady, setChatAccessReady] = useState(false);
  const [tokenResolved, setTokenResolved] = useState(false);

  /**
   * 計画を D1 から取り直す。初回表示とチャットの修正適用後で共用する。
   * 再取得中は旧内容を表示したままにして、しおりがチラつかないようにする。
   */
  const reload = useCallback(async () => {
    try {
      const data = await getPlan(planId);
      setState({ status: "ready", data });
    } catch (e) {
      // 初回表示前の失敗はエラー画面へ。取得済みの内容があるなら残したまま黙って諦める。
      setState((prev) =>
        prev.status === "ready" ? prev : { status: "error", message: String(e) },
      );
    }
  }, [planId]);

  useEffect(() => {
    setState({ status: "loading" });
    void reload();
  }, [reload]);

  // sessionStorage は SSR 中に触れないため、マウント後に一度だけ解決する。
  useEffect(() => {
    setChatAccessReady(loadChatAccess(planId) !== null);
    setTokenResolved(true);
  }, [planId]);

  const handleUnauthorized = useCallback(() => {
    // サーバに拒否された許可マーカーは捨て、gate を出し直す。
    clearChatAccess(planId);
    setChatAccessReady(false);
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
  // 計画が完成するまでチャットは出さない（修正対象が確定していない）。
  const chatReady = state.data.status === "completed" && plan !== null;

  return (
    <AppShell
      title="旅のしおり"
      back={{ href: "/" }}
      trailing={plan ? <PrintButton planTitle={plan.title} /> : null}
    >
      <div className="w-full max-w-3xl mx-auto py-6 sm:py-10 px-2 sm:px-4 print:max-w-none print:p-0">
        <div
          id="itinerary-print-root"
          className="bg-paper border-y-2 border-line sm:border-2 sm:rounded-3xl shadow-toy-lg relative overflow-hidden flex flex-col print:border-none print:shadow-none print:rounded-none print:overflow-visible print:bg-transparent"
        >
          {/* Red vertical margin line for the whole notebook */}
          <div className="absolute left-6 md:left-10 top-0 bottom-0 w-[2px] bg-[var(--margin-line)] z-0 pointer-events-none print:hidden" />

          {/* Lined paper background pattern */}
          <div
            className="absolute inset-0 pointer-events-none z-0 opacity-50 print:hidden"
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
              {plan?.days?.map((day, i, arr) => (
                <div
                  key={day.dayNumber}
                  className={i !== arr.length - 1 ? "border-b-2 border-dashed border-line/20" : ""}
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

        {/* 接続許可が無い／失効したときは、チャットの前に人間性検証を挟む（#20）。 */}
        {chatReady && tokenResolved && !chatAccessReady ? (
          <ChatAccessGate planId={planId} onGranted={() => setChatAccessReady(true)} />
        ) : null}
      </div>

      {chatReady && chatAccessReady ? (
        <ItineraryChat
          planId={planId}
          displayedVersion={state.data.version}
          onUnauthorized={handleUnauthorized}
          onPlanApplied={reload}
        />
      ) : null}
    </AppShell>
  );
}

/**
 * 常駐チャットのドック（#20）。
 *
 * `useTravelChat` は接続許可が確定してから呼ぶ必要があるため、条件分岐の内側で
 * マウントできるよう別コンポーネントに切り出す（フックを条件付きで呼ばないため）。
 */
function ItineraryChat({
  planId,
  displayedVersion,
  onUnauthorized,
  onPlanApplied,
}: {
  planId: string;
  /** いま画面に描いている計画のバージョン。 */
  displayedVersion: number;
  onUnauthorized: () => void;
  /** 修正が適用されたときに、しおり表示を D1 から取り直す。 */
  onPlanApplied: () => void;
}) {
  const chat = useTravelChat({ planId, onUnauthorized, onPlanMaybeChanged: onPlanApplied });
  const appliedVersion = chat.state?.appliedVersion ?? null;

  /**
   * 修正の承認は Agent 側で D1 を更新する。表示は D1 を単一の真実として取り直し、
   * Agent state をそのまま描画しない（バージョン復元など他経路の変更も拾えるため）。
   *
   * 判定は「Agent が適用したと言うバージョン」と「いま描いているバージョン」の比較で行う。
   * `appliedVersion` の変化を追う方式だと、DO state に前回セッションの値が残っている場合に
   * 同じ値が再送されて再取得が起きず、しおりが古いまま取り残される。
   */
  useEffect(() => {
    if (appliedVersion === null) return;
    if (appliedVersion === displayedVersion) return;
    onPlanApplied();
  }, [appliedVersion, displayedVersion, onPlanApplied]);

  return (
    <ChatDock title="旅のチャット" badge={chat.state?.pendingEdit != null}>
      <TravelChat chat={chat} />
    </ChatDock>
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
