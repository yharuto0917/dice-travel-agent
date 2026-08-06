"use client";

import { type UIEvent, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** 「最下部にいる」と見なす余白（px）。慣性スクロールの誤差を吸収する。 */
const BOTTOM_THRESHOLD = 48;

/** 上端からこの距離まで来たら、より古い履歴の読み込みを要求する。 */
const TOP_THRESHOLD = 64;

export interface ConversationProps {
  children: React.ReactNode;
  /**
   * 末尾へ自動スクロールする契機。メッセージ件数やストリーミング中の文字数など、
   * 「増えたら追従したい値」を渡す。
   */
  autoScrollKey?: string | number;
  /** 上端に達したときに呼ばれる（過去ログの追加読み込み）。 */
  onReachTop?: () => void;
  className?: string;
}

/**
 * メッセージを縦に積むチャットの器（#20）。
 *
 * 追従スクロールは「利用者が最下部付近にいるときだけ」行う。過去ログを読み返している
 * 最中に新着で強制的に飛ばされると読めなくなるため。上端に近づいたら `onReachTop` で
 * D1 アーカイブの前ページを要求する。
 */
export function Conversation({
  children,
  autoScrollKey,
  onReachTop,
  className,
}: ConversationProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  // 過去ログ追加時に見ていた位置を保つため、読み込み前の高さを覚えておく。
  const prevScrollHeightRef = useRef<number | null>(null);
  // 直前に追従した契機。初回マウント時の重複スクロールを避けるために比較する。
  const lastScrollKeyRef = useRef<string | number | undefined>(undefined);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
    if (el.scrollTop <= TOP_THRESHOLD && onReachTop) {
      prevScrollHeightRef.current = el.scrollHeight;
      onReachTop();
    }
  };

  // 新着で末尾へ追従する（最下部にいるときだけ）。描画確定後に測るため layout effect。
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 初回マウント時は下の effect が末尾へ寄せるので、ここでは何もしない。
    if (lastScrollKeyRef.current === undefined) {
      lastScrollKeyRef.current = autoScrollKey;
      return;
    }
    lastScrollKeyRef.current = autoScrollKey;

    // 過去ログが前方に挿入された場合は、増えた高さ分だけ位置をずらして見た目を保つ。
    const prevHeight = prevScrollHeightRef.current;
    if (prevHeight !== null && el.scrollHeight > prevHeight) {
      el.scrollTop += el.scrollHeight - prevHeight;
      prevScrollHeightRef.current = null;
      return;
    }

    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [autoScrollKey]);

  // 初回表示は必ず最新（末尾）から見せる。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={cn("flex flex-col gap-3 overflow-y-auto overscroll-contain", className)}
    >
      {children}
    </div>
  );
}
