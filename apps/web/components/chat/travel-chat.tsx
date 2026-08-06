"use client";

import type { UIMessage } from "ai";
import { useState } from "react";
import { Conversation } from "@/components/ai-elements/conversation";
import { Message, MessageAvatar, MessageContent } from "@/components/ai-elements/message";
import { PromptInput } from "@/components/ai-elements/prompt-input";
import { Reasoning } from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import { PlanEditProposal } from "@/components/chat/plan-edit-proposal";
import type { useTravelChat } from "@/lib/hooks/use-travel-chat";

/** 会話が空のときに提示する例文。何を聞けるか分からない状態を避ける。 */
const SUGGESTIONS = ["2日目の昼食はどこ？", "雨が降ったらどうする？", "3日目を温泉中心に変えて"];

/** UIMessage のテキストパートを連結する。 */
function textOf(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * UIMessage の思考（reasoning）パートを連結する。
 *
 * 質問応答の思考はモデルからメッセージのパートとして届く（修正案づくりは
 * メッセージを作らないので、そちらは transient data の `reasoning` で受け取る）。
 */
function reasoningOf(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "reasoning"; text: string } => part.type === "reasoning")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

/**
 * 常駐チャットの本体（#20）。
 * 接続・ストリーム管理は {@link useTravelChat} が持ち、ここは表示と入力に徹する。
 */
export function TravelChat({ chat }: { chat: ReturnType<typeof useTravelChat> }) {
  const {
    messages,
    archive,
    send,
    isStreaming,
    activity,
    reasoning,
    rateLimit,
    state,
    applyEdit,
    rejectEdit,
    hasMoreArchive,
    loadOlder,
  } = chat;

  const pendingEdit = state?.pendingEdit ?? null;

  // 「押下中」は提案IDで持つ。boolean にすると提案が入れ替わっても解除されず、
  // 別の提案のボタンが押せないまま固まってしまう。
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const applying = applyingId !== null && applyingId === pendingEdit?.id;

  // ライブ会話（Agent の保持分）に含まれる id は、アーカイブ側から除いて二重表示を防ぐ。
  const liveIds = new Set(messages.map((m) => m.id));
  const olderMessages = archive.filter((m) => !liveIds.has(m.id));

  const exhausted = rateLimit?.remaining === 0;
  const isEmpty = messages.length === 0 && olderMessages.length === 0;

  // ストリーミング中も末尾へ追従できるよう、最新メッセージの本文長も追従キーに含める。
  // 本文より先に思考が伸びるので、思考の長さ（メッセージ内・修正案づくりの双方）も混ぜる。
  const lastMessage = messages.at(-1);
  const autoScrollKey = `${olderMessages.length}:${messages.length}:${
    lastMessage ? textOf(lastMessage).length : 0
  }:${lastMessage ? reasoningOf(lastMessage).length : 0}:${reasoning?.length ?? 0}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Conversation
        className="min-h-0 flex-1 px-4 py-3"
        autoScrollKey={autoScrollKey}
        onReachTop={hasMoreArchive ? loadOlder : undefined}
      >
        {isEmpty ? (
          <div className="flex flex-col gap-2 py-2">
            <p className="text-xs leading-relaxed text-muted">
              しおりについて質問したり、旅程の修正を相談できます。
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  disabled={exhausted}
                  className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[0.7rem] font-bold text-foreground transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {olderMessages.map((message) => {
          // system は表示対象外（サーバ内部の記録）。
          if (message.role === "system") return null;
          return (
            <Message key={message.id} from={message.role}>
              <MessageAvatar from={message.role} />
              <MessageContent from={message.role}>
                {message.role === "assistant" ? (
                  <Response>{message.content}</Response>
                ) : (
                  <span className="whitespace-pre-wrap break-words">{message.content}</span>
                )}
              </MessageContent>
            </Message>
          );
        })}

        {messages.map((message) => {
          if (message.role === "system") return null;
          const text = textOf(message);
          const thought = message.role === "assistant" ? reasoningOf(message) : "";
          // 本文も思考も無いメッセージは出さない。逆に、本文が来る前でも思考があれば出す
          // （考えている最中の空白を埋める）。
          if (!text && !thought) return null;
          const isLast = message.id === messages.at(-1)?.id;
          return (
            <Message key={message.id} from={message.role}>
              <MessageAvatar from={message.role} />
              <MessageContent from={message.role}>
                {thought ? (
                  <Reasoning
                    text={thought}
                    // 本文が出はじめたら思考は済んでいるので、そこでライブ表示を畳む。
                    streaming={isStreaming && isLast && !text}
                    className="mb-1.5"
                  />
                ) : null}
                {message.role === "assistant" ? (
                  text ? (
                    <Response streaming={isStreaming && isLast}>{text}</Response>
                  ) : null
                ) : (
                  <span className="whitespace-pre-wrap break-words">{text}</span>
                )}
              </MessageContent>
            </Message>
          );
        })}

        {activity ? (
          <p className="flex items-center gap-2 px-1 text-[0.7rem] font-bold text-muted">
            <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            {activity}
          </p>
        ) : null}

        {/* 修正案づくりの思考。生成が終わっても残し、提案と並べて読めるようにする。
            修正案づくりは本文を書かずに進むので `isStreaming` が立たない。実行中の合図は
            activity（完了時に消える）なので、そちらでライブ表示を判定する。 */}
        {reasoning ? (
          <Reasoning text={reasoning} streaming={activity !== null} className="px-1" />
        ) : null}

        {pendingEdit ? (
          <PlanEditProposal
            edit={pendingEdit}
            applying={applying}
            onApply={() => {
              setApplyingId(pendingEdit.id);
              applyEdit(pendingEdit.id);
            }}
            onReject={() => rejectEdit(pendingEdit.id)}
          />
        ) : null}
      </Conversation>

      <div className="border-t-2 border-line px-4 pt-3">
        <PromptInput
          onSubmit={send}
          disabled={isStreaming || exhausted}
          autoFocus
          hint={
            exhausted && rateLimit ? (
              <span className="text-red-500">
                本日の上限（{rateLimit.limit}回）に達しました。{formatResetAt(rateLimit.resetAt)}
                以降にまたご利用いただけます。
              </span>
            ) : rateLimit ? (
              <span>
                本日の残り {rateLimit.remaining} / {rateLimit.limit} 回
              </span>
            ) : null
          }
        />
      </div>
    </div>
  );
}

/** ISO 文字列を「7/31 0:00」のような JST 表記へ整形する。 */
function formatResetAt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
