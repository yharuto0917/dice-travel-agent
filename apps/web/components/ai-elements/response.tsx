"use client";

import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

/**
 * ストリーミング中の Markdown を崩さず描画する共通コンポーネント。
 *
 * 生成中は未完のブロック（閉じていないコードフェンス等）が届くため、
 * `parseIncompleteMarkdown` を有効にして描画の破綻を防ぐ。
 * 計画生成の思考表示（`app/generating/page.tsx`）と常駐チャット（#20）で
 * 同じ体裁を使うため、Streamdown の設定はここに集約する。
 */
export function Response({
  children,
  streaming = false,
  className,
}: {
  children: string;
  /** 生成中かどうか。未完 Markdown の補正を有効にする。 */
  streaming?: boolean;
  className?: string;
}) {
  return (
    <Streamdown
      parseIncompleteMarkdown={streaming}
      className={cn(
        // 吹き出し内の密度を上げるため、ブロック間マージンを詰める。
        "[&_:first-child]:mt-0 [&_:last-child]:mb-0",
        "[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5",
        "[&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4",
        "[&_h1]:my-1.5 [&_h2]:my-1.5 [&_h3]:my-1.5",
        "[&_:is(h1,h2,h3)]:font-bold [&_h1]:text-[0.95rem] [&_h2]:text-[0.9rem] [&_h3]:text-[0.85rem]",
        "[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.75rem]",
        "[&_a]:text-primary [&_a]:underline [&_strong]:font-bold",
        className,
      )}
    >
      {children}
    </Streamdown>
  );
}
