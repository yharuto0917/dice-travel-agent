import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * AI Elements 風のチャット・プリミティブ（表示専用の土台）。
 * #13 / #20 で AI SDK UI(useAgentChat) と結線して使う。
 */
export type MessageRole = "user" | "assistant";

export function Message({
  role,
  className,
  children,
}: {
  role: MessageRole;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex w-full items-end gap-2",
        role === "user" ? "flex-row-reverse" : "flex-row",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MessageAvatar({ role }: { role: MessageRole }) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
        role === "user"
          ? "bg-accent text-accent-foreground"
          : "bg-sky/40 text-foreground",
      )}
      aria-hidden
    >
      {role === "user" ? "あ" : "AI"}
    </div>
  );
}

export function MessageContent({
  role,
  children,
}: {
  role: MessageRole;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-toy",
        role === "user"
          ? "rounded-br-md bg-primary text-primary-foreground"
          : "rounded-bl-md border border-line bg-surface text-foreground",
      )}
    >
      {children}
    </div>
  );
}
