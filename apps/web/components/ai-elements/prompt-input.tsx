"use client";

import { PaperPlaneRight } from "@phosphor-icons/react";
import { type KeyboardEvent, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** サーバ側の `SendChatMessageRequestSchema` と揃える（超過分は送る前に弾く）。 */
const MAX_LENGTH = 2000;

/** 入力欄の高さ（px）。内容に応じてこの範囲で伸縮する。 */
const MIN_HEIGHT = 44;
const MAX_HEIGHT = 132;

export interface PromptInputProps {
  onSubmit: (value: string) => void;
  /** 送信不可（応答待ち・上限到達など）。 */
  disabled?: boolean;
  placeholder?: string;
  /** 入力欄の下に出す補足（残回数・エラーなど）。 */
  hint?: React.ReactNode;
  /** 開いた直後に自動でフォーカスする。 */
  autoFocus?: boolean;
  className?: string;
}

/**
 * チャットの入力欄（#20）。
 *
 * Enter で送信、Shift+Enter で改行。モバイルの日本語入力では変換確定の Enter が
 * そのまま送信になってしまうため、IME 変換中（`isComposing`）は送信しない。
 */
export function PromptInput({
  onSubmit,
  disabled = false,
  placeholder = "旅について質問・修正を相談する",
  hint,
  autoFocus = false,
  className,
}: PromptInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSubmit = !disabled && value.trim().length > 0 && value.length <= MAX_LENGTH;

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)}px`;
  };

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(value.trim());
    setValue("");
    // 送信後は入力欄の高さも初期状態へ戻す。
    requestAnimationFrame(resize);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 変換確定の Enter を送信と誤認しない（日本語入力で必須）。
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            resize();
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={MAX_LENGTH}
          disabled={disabled}
          // biome-ignore lint/a11y/noAutofocus: ドロワーを開いた直後に入力へ移すのは意図的な導線。
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label="チャットメッセージ"
          className="min-h-11 min-w-0 flex-1 resize-none rounded-2xl border-2 border-line bg-surface px-3.5 py-2.5 text-sm leading-relaxed placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          aria-label="送信"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-line bg-primary text-primary-foreground shadow-toy transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          <PaperPlaneRight size={18} weight="fill" />
        </button>
      </div>
      {hint ? <div className="px-1 text-[0.7rem] font-bold text-muted">{hint}</div> : null}
    </div>
  );
}
