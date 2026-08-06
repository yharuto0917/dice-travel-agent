"use client";

import { ArrowRight, Compass } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { Card, CardBody } from "@/components/ui/card";
import { createChatAccess, RateLimitError, TurnstileError } from "@/lib/api";
import { loadChatAccess, saveChatAccess } from "@/lib/chat-access-token";
import { formatHistoryDate } from "@/lib/history";

/**
 * Home の作成履歴カード（#20）。
 *
 * しおりでは常駐チャットが使えるため、生成フローを経ない再訪でも人間性検証を通す。
 * 生成直後（`POST /plans` でトークンを受け取っている）や、まだ有効なトークンが
 * 残っている場合は確認を挟まずそのまま遷移する。ここで取り損ねても、しおり側の
 * `ChatAccessGate` が同じ検証をやり直せるので導線は途切れない。
 */
export function HistoryPlanLink({
  planId,
  title,
  createdAt,
}: {
  planId: string;
  title: string;
  createdAt: string;
}) {
  const router = useRouter();
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  const go = useCallback(() => {
    router.push(`/itinerary?planId=${planId}`);
  }, [router, planId]);

  const handleOpen = useCallback(() => {
    // 有効なトークンが残っていれば確認は不要。
    if (loadChatAccess(planId)) {
      go();
      return;
    }
    setVerifying(true);
  }, [planId, go]);

  const handleVerify = useCallback(
    async (turnstileToken: string) => {
      setError(null);
      try {
        const access = await createChatAccess(planId, turnstileToken);
        saveChatAccess(planId, {
          token: access.chatAccessToken,
          expiresAt: access.expiresAt,
        });
        go();
      } catch (e) {
        if (e instanceof TurnstileError) setError(e.message);
        else if (e instanceof RateLimitError) {
          setError("利用回数の上限に達しました。時間をおいてお試しください。");
        } else setError("確認に失敗しました。もう一度お試しください。");
        setResetSignal((n) => n + 1);
      }
    },
    [planId, go],
  );

  return (
    <Card className="transition hover:-translate-y-0.5 hover:shadow-toy-lg">
      <button
        type="button"
        onClick={handleOpen}
        aria-expanded={verifying}
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-3xl"
      >
        <CardBody className="flex items-center gap-3 p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-foreground">
            <Compass size={22} weight="duotone" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">{title}</span>
            <span className="block truncate text-xs text-muted">
              {formatHistoryDate(createdAt)} に作成
            </span>
          </span>
          <ArrowRight size={18} weight="bold" className="ml-auto shrink-0 text-muted" />
        </CardBody>
      </button>

      {verifying ? (
        <div className="flex flex-col gap-2 border-t-2 border-line px-4 py-3">
          <p className="text-xs font-bold text-muted">確認してからしおりを開きます</p>
          <TurnstileWidget
            className="w-full"
            onVerify={(token) => void handleVerify(token)}
            onExpire={() => setError(null)}
            resetSignal={resetSignal}
          />
          {error ? <p className="text-xs font-bold text-red-500">{error}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
