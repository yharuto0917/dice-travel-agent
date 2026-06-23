import type * as React from "react";
import { cn } from "@/lib/utils";

/** メッセージを縦に積むチャットの器（AI Elements 風の表示専用土台）。 */
export function Conversation({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("flex flex-col gap-3", className)}>{children}</div>;
}
