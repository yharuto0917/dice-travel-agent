"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile ウィジェット（#49・ボット/乱用対策の人間性検証）。
 *
 * 明示レンダリング（`window.turnstile.render`）でトークンを取得し `onVerify` に渡す。
 * ローカル開発（localhost / 127.0.0.1）では `NEXT_PUBLIC_TURNSTILE_SITE_KEY` の値に
 * 関わらず Cloudflare 公式のテストサイトキー（常に成功）を使う。本番サイトキーは
 * localhost を許可ドメインに含まないため、そのまま使うと 400020 エラーになるため。
 * 同様に環境変数が未設定の場合もテストサイトキーにフォールバックする。
 */

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
/** Cloudflare 公式のテスト用サイトキー（常に成功）。ローカル開発の既定値。 */
const TEST_SITE_KEY = "1x00000000000000000000AA";

/** ローカル開発環境（localhost / 127.0.0.1 / *.localhost）かどうかを判定する。 */
function isLocalHost(): boolean {
  if (typeof window === "undefined") return false;
  const { hostname } = window.location;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

/** 実際に使用する Turnstile サイトキーを返す。ローカルでは常にテストキー。 */
function resolveSiteKey(): string {
  if (isLocalHost()) return TEST_SITE_KEY;
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? TEST_SITE_KEY;
}

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
  /**
   * 値が変わるたびにウィジェットを reset し、新しいトークンを取り直す。
   * トークンは単回使用のため、送信に失敗（消費済み）した後の再試行に使う。
   * 初期値（0）では何もしない。
   */
  resetSignal?: number;
  className?: string;
}

export function TurnstileWidget({
  onVerify,
  onExpire,
  resetSignal,
  className,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 親の再レンダリングでウィジェットを作り直さないよう、コールバックは ref 経由で参照する。
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  onVerifyRef.current = onVerify;
  onExpireRef.current = onExpire;
  // reset 要求（resetSignal の変化）から参照できるよう、ウィジェットIDを ref で保持する。
  const widgetIdRef = useRef<string | null>(null);

  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // サイトキーは effect 内（クライアントでのみ実行・window が必ず存在）で確定する。
    // localhost ではここで TEST_SITE_KEY が選ばれ、本番サイトキーによる 400020 を避ける。
    const siteKey = resolveSiteKey();

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
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
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // 既に除去済みなどは無視する。
        }
        widgetIdRef.current = null;
      }
    };
    // マウント時に一度だけウィジェットを生成する（サイトキーは effect 内で確定）。
  }, []);

  // 親からの reset 要求。消費済みトークンを破棄して新しいチャレンジを発火し、
  // 成功すれば callback 経由で新しいトークンが onVerify に渡る。
  useEffect(() => {
    if (!resetSignal) return; // 初期値（0/未設定）では何もしない。
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        // 未レンダリング・除去済みなどは無視する。
      }
    }
  }, [resetSignal]);

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
