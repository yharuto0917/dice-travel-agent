"use client";

import { ShieldCheck } from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { Card, CardBody } from "@/components/ui/card";
import { createChatAccess, RateLimitError, TurnstileError } from "@/lib/api";
import { saveChatAccess } from "@/lib/chat-access-token";

/**
 * 常駐チャットの接続許可 Cookie を取り直すゲート（#20）。
 *
 * 生成直後は `POST /plans` が同じ Turnstile 検証の中でトークンを返すため出番はない。
 * ここが出るのは「Home の作成履歴から入った」「URL を直接開いた」「トークンが期限切れ」
 * のいずれか。所有者確認と人間性検証を通してから Chat Agent へ接続させる。
 */
export function ChatAccessGate({
  planId,
  onGranted,
}: {
  planId: string;
  /** HttpOnly Cookie の発行に成功したときに呼ばれる。 */
  onGranted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // トークンは単回使用のため、失敗したら新しいチャレンジを引き直す。
  const [resetSignal, setResetSignal] = useState(0);

  const handleVerify = useCallback(
    async (turnstileToken: string) => {
      setPending(true);
      setError(null);
      try {
        const access = await createChatAccess(planId, turnstileToken);
        saveChatAccess(planId, {
          expiresAt: access.expiresAt,
        });
        onGranted();
      } catch (e) {
        if (e instanceof TurnstileError) {
          setError(e.message);
        } else if (e instanceof RateLimitError) {
          setError("利用回数の上限に達しました。時間をおいてお試しください。");
        } else {
          setError("チャットの準備に失敗しました。ページを再読み込みしてお試しください。");
        }
        setResetSignal((n) => n + 1);
      } finally {
        setPending(false);
      }
    },
    [planId, onGranted],
  );

  return (
    <Card className="mt-4 print:hidden">
      <CardBody className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-primary">
          <ShieldCheck size={24} weight="duotone" />
        </span>
        <p className="text-sm font-bold">チャットを使うには確認が必要です</p>
        <p className="text-xs leading-relaxed text-muted">
          このしおりについて質問・修正の相談をするために、簡単な確認を行います。
        </p>
        <TurnstileWidget
          className="w-full"
          onVerify={(token) => void handleVerify(token)}
          onExpire={() => setError(null)}
          resetSignal={resetSignal}
        />
        {pending ? <p className="text-xs font-bold text-muted">確認しています…</p> : null}
        {error ? <p className="text-xs font-bold text-red-500">{error}</p> : null}
      </CardBody>
    </Card>
  );
}
