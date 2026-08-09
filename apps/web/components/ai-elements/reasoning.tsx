"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Response } from "@/components/ai-elements/response";
import { cn } from "@/lib/utils";

/**
 * 思考過程の折りたたみ表示（#20）。
 *
 * 生成中は「今どこを考えているか」が分かるよう末尾だけを流し込み（自動で下端へ追従）、
 * 終わったら畳んで会話の流れを邪魔しない。読みたい人だけが開けばよい、という扱い。
 * 計画生成の実行履歴（`app/generating/page.tsx`）と同じく Markdown で描画する。
 */
export function Reasoning({
  text,
  streaming = false,
  className,
}: {
  text: string;
  /** 生成中かどうか。真なら本文を出したまま末尾へ追従する。 */
  streaming?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const liveRef = useRef<HTMLDivElement>(null);

  // 生成中は流れ込む思考の末尾を見せ続ける（開いて読む前提ではないので高さは抑える）。
  // text が伸びるたびに下端へ追従させる。
  useEffect(() => {
    const el = liveRef.current;
    if (el && text.length > 0) el.scrollTop = el.scrollHeight;
  }, [text]);

  const expanded = streaming || open;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 self-start text-[0.7rem] font-bold text-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {streaming ? (
          <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
        ) : (
          <CaretDown
            size={12}
            weight="bold"
            className={cn("transition-transform", open ? null : "-rotate-90")}
          />
        )}
        {streaming ? "考えています" : open ? "思考を閉じる" : "思考を見る"}
      </button>

      {expanded ? (
        <div
          ref={streaming ? liveRef : undefined}
          className={cn(
            "rounded-xl bg-surface-2/60 px-2.5 py-1.5 text-[0.68rem] leading-relaxed text-muted/90",
            // 生成中は高さを固定して末尾へ流す。開いて読むときは全文を出す。
            streaming ? "max-h-20 overflow-hidden" : "max-h-64 overflow-y-auto",
          )}
        >
          <Response streaming={streaming} className="text-[0.68rem]">
            {text}
          </Response>
        </div>
      ) : null}
    </div>
  );
}
