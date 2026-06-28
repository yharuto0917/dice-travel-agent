"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile ウィジェット（#49・ボット/乱用対策の人間性検証）。
 *
 * 明示レンダリング（`window.turnstile.render`）でトークンを取得し `onVerify` に渡す。
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 未設定時は Cloudflare 公式のテストサイトキー
 * （常に成功）を使うため、ローカル開発では設定なしでも通常フローを阻害しない。
 */

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
/** Cloudflare 公式のテスト用サイトキー（常に成功）。ローカル開発の既定値。 */
const TEST_SITE_KEY = "1x00000000000000000000AA";

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "flexible" | "compact";
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: TurnstileRenderOptions) => string;
      remove: (id: string) => void;
      reset: (id?: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

/** Turnstile スクリプトを冪等にロードする。読込失敗時は次回再試行できるようキャッシュを破棄する。 */
function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("turnstile script failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile script failed"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

interface TurnstileWidgetProps {
  /** 検証成功時にトークンを受け取る。 */
  onVerify: (token: string) => void;
  /** トークン失効・エラー時（トークンを無効化したいとき）。 */
  onExpire?: () => void;
  className?: string;
}

export function TurnstileWidget({ onVerify, onExpire, className }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 親の再レンダリングでウィジェットを作り直さないよう、コールバックは ref 経由で参照する。
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  onVerifyRef.current = onVerify;
  onExpireRef.current = onExpire;

  const [loadFailed, setLoadFailed] = useState(false);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? TEST_SITE_KEY;

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | null = null;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onVerifyRef.current(token),
          "expired-callback": () => onExpireRef.current?.(),
          "error-callback": () => onExpireRef.current?.(),
          theme: "auto",
          size: "flexible",
        });
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // 既に除去済みなどは無視する。
        }
      }
    };
  }, [siteKey]);

  if (loadFailed) {
    return (
      <p className={className}>
        <span className="text-xs font-bold text-red-500">
          ボット対策の読み込みに失敗しました。通信環境を確認のうえページを再読み込みしてください。
        </span>
      </p>
    );
  }

  return <div ref={containerRef} className={className} />;
}
