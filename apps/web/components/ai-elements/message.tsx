import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * AI Elements 風のチャット・プリミティブ（表示専用の土台）。
 * #13 / #20 で AI SDK UI(useAgentChat) と結線して使う。
 * 送り手は `from`（"user" | "assistant"）で指定する。
 */
export type MessageRole = "user" | "assistant";

export function Message({
  from,
  className,
  children,
}: {
  from: MessageRole;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex w-full items-end gap-2",
        from === "user" ? "flex-row-reverse" : "flex-row",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MessageAvatar({ from }: { from: MessageRole }) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
        from === "user" ? "bg-accent text-accent-foreground" : "bg-sky/40 text-foreground",
      )}
      aria-hidden
    >
      {from === "user" ? "あ" : "AI"}
    </div>
  );
}

export function MessageContent({
  from,
  children,
}: {
  from: MessageRole;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-toy",
        from === "user"
          ? "rounded-br-md bg-primary text-primary-foreground"
          : "rounded-bl-md border border-line bg-surface text-foreground",
      )}
    >
      {children}
    </div>
  );
}
