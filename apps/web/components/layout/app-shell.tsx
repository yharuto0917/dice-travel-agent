import * as React from "react";
import Link from "next/link";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr";

type AppShellProps = {
  children: React.ReactNode;
  title?: string;
  /** 戻る導線（省略時はヘッダーに戻るボタンを出さない） */
  back?: { href: string; label?: string };
  trailing?: React.ReactNode;
};

/** Mobile-first の共通シェル。セーフエリア対応の固定ヘッダー＋スクロール本文。 */
export function AppShell({ children, title, back, trailing }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line/70 bg-background/80 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        {back ? (
          <Link
            href={back.href}
            aria-label={back.label ?? "戻る"}
            className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground transition hover:bg-surface-2"
          >
            <CaretLeft size={20} weight="bold" />
          </Link>
        ) : null}
        {title ? (
          <span className="text-base font-extrabold tracking-tight">{title}</span>
        ) : null}
        {trailing ? <div className="ml-auto">{trailing}</div> : null}
      </header>

      <main className="flex flex-1 flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
        {children}
      </main>
    </div>
  );
}
