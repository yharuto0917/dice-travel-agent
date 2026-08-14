"use client";

import { ChatCircleDots, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** フォーカス可能な要素のセレクタ（focus trap の対象）。 */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface ChatDockProps {
  title: string;
  children: React.ReactNode;
  /** 閉じているときの FAB に添えるバッジ（未読・提案ありの合図など）。 */
  badge?: boolean;
}

/**
 * 常駐チャットのドック（#20）。
 *
 * - モバイル: 画面下からせり上がるボトムドロワー
 * - PC（sm 以上）: 右下のフローティングパネル
 *
 * Radix / vaul は導入せず、既存の手書きコンポーネント方針に合わせて自前で実装する。
 * ダイアログとして最低限成立させるため、フォーカス管理（開いたら中へ、閉じたら FAB へ戻す）、
 * Tab の巡回、背面のスクロールロック、Esc/オーバーレイでの閉止を備える。
 */
export function ChatDock({ title, children, badge = false }: ChatDockProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const close = useCallback(() => setOpen(false), []);

  // 開いている間は背面をスクロールさせない（ドロワー内のスクロールと競合させない）。
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // 開いたら中の先頭へフォーカスを移し、閉じたら起点の FAB へ戻す。
  useEffect(() => {
    if (open) {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    } else {
      triggerRef.current?.focus();
    }
    // 初回マウント時に FAB へ勝手にフォーカスが移らないよう、open の変化だけを見る。
  }, [open]);

  // Esc で閉じ、Tab はパネル内で巡回させる。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusables = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      const first = focusables[0];
      const last = focusables.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${title}を開く`}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full border-2 border-line bg-primary text-primary-foreground shadow-toy-lg transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:bottom-6 sm:right-6 print:hidden"
      >
        <ChatCircleDots size={26} weight="fill" />
        {badge ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-line bg-accent"
          />
        ) : null}
      </button>
    );
  }

  return (
    <>
      {/* オーバーレイ。クリックで閉じる。装飾要素なのでキーボード操作は Esc が担う。 */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={close}
        className="fixed inset-0 z-40 cursor-default bg-ink/30 sm:bg-ink/10 print:hidden"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-3xl border-2 border-line bg-surface shadow-toy-lg print:hidden",
          // モバイル: 画面の 80% までのボトムドロワー。キーボード表示時も入力欄が隠れないよう
          // dvh を使い、セーフエリア分の余白を確保する。
          "max-h-[80dvh]",
          // PC: 右下のフローティングパネル。しおり（max-w-md フレーム）と重ならない位置に置く。
          "sm:inset-x-auto sm:bottom-6 sm:right-6 sm:h-[560px] sm:max-h-[calc(100dvh-3rem)] sm:w-[380px] sm:rounded-3xl",
        )}
      >
        <header className="flex items-center gap-2 border-b-2 border-line px-4 py-3">
          <ChatCircleDots size={20} weight="duotone" className="text-primary" />
          <h2 id={titleId} className="text-sm font-extrabold">
            {title}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="閉じる"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={18} weight="bold" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3">
          {children}
        </div>
      </div>
    </>
  );
}
