"use client";

import { useAgentChat } from "@cloudflare/ai-chat/react";
import {
  CHAT_ACCESS_QUERY_PARAM,
  ChatDataPartSchema,
  type ChatMessage,
  type RateLimitStatus,
  type TravelChatState,
} from "@repo/shared";
import { useAgent } from "agents/react";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { AGENT_HOST, TRAVEL_CHAT_AGENT_NAME } from "@/lib/agent";
import { getChatMessages } from "@/lib/api";

/** D1 アーカイブを1回に読む件数。 */
const ARCHIVE_PAGE_SIZE = 20;

/**
 * 接続が確立しないまま許容する連続切断の回数。
 * 認可に失敗したトークンで無限に再接続してページを固めないための上限。
 */
const MAX_CONNECT_FAILURES = 3;

export interface UseTravelChatOptions {
  planId: string;
  /** 接続許可トークン。無い場合は接続しない（呼び出し側が gate を出す）。 */
  token: string;
  /** 認可に失敗した（トークンが無効・期限切れ）ときに通知する。 */
  onUnauthorized?: () => void;
  /**
   * 計画が書き換わった可能性があるときに通知する（承認・却下の直後）。
   * 呼び出し側は D1 から計画を取り直す。
   */
  onPlanMaybeChanged?: () => void;
}

export interface UseTravelChatResult {
  messages: UIMessage[];
  /** メッセージを送る。応答はストリームで `messages` に反映される。 */
  send: (text: string) => void;
  /** 応答生成中かどうか（クライアント発・サーバ発の双方を含む）。 */
  isStreaming: boolean;
  /** 実行中の状況（ツール実行など）。アイドル時は null。 */
  activity: string | null;
  /**
   * 直近の修正案づくりの思考過程。まだ何も届いていなければ null。
   *
   * 応答が終わっても消さない（提案と並べて「なぜこの案になったか」を読めるようにする）。
   * 次の発話を送った時点で捨てる。
   */
  reasoning: string | null;
  /** 直近に受け取ったチャットのレート制限状況。 */
  rateLimit: RateLimitStatus | null;
  /** 承認待ちの修正提案と適用済みバージョン。 */
  state: TravelChatState | null;
  /** 修正提案を承認する。 */
  applyEdit: (id: string) => void;
  /** 修正提案を破棄する。 */
  rejectEdit: (id: string) => void;
  /** DO の保持上限より古い履歴（D1 アーカイブ）。古い順。 */
  archive: ChatMessage[];
  /** さらに古い履歴があるか。 */
  hasMoreArchive: boolean;
  /** 古い履歴を1ページ読み足す。 */
  loadOlder: () => void;
}

/**
 * 常駐チャット（#20）のクライアント側の結線。
 *
 * ライブ会話・ストリーム再開・メッセージ永続化は `useAgentChat` に任せ、ここでは
 * transient data（実行状況・提案・レート制限）の取り出しと、DO の保持上限より古い
 * 履歴の読み足しだけを受け持つ。
 */
export function useTravelChat({
  planId,
  token,
  onUnauthorized,
  onPlanMaybeChanged,
}: UseTravelChatOptions): UseTravelChatResult {
  const [state, setState] = useState<TravelChatState | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitStatus | null>(null);
  const [archive, setArchive] = useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // 初回ロードが済むまで nextCursor（null）を「もう無い」と誤判定しないための印。
  const archiveLoadedRef = useRef(false);
  const loadingArchiveRef = useRef(false);

  const agent = useAgent<TravelChatState>({
    agent: TRAVEL_CHAT_AGENT_NAME,
    name: planId,
    host: AGENT_HOST,
    // トークンはクエリで渡す。Hono の認可ゲートが planId・所有者と突き合わせる。
    query: { [CHAT_ACCESS_QUERY_PARAM]: token },
    onStateUpdate: (next) => setState(next),
  });

  const chat = useAgentChat<TravelChatState>({
    agent,
    // 切断・再接続でも生成中の応答を取りこぼさない。
    resume: true,
    onData: (part) => {
      const parsed = ChatDataPartSchema.safeParse(part);
      // 未知の data part（SDK 追加分など）は無視する。UI を壊さないことを優先。
      if (!parsed.success) return;

      if (parsed.data.type === "data-activity") setActivity(parsed.data.data.label);
      if (parsed.data.type === "data-rate-limit") setRateLimit(parsed.data.data);
      // 思考は毎回「その時点までの全文」が届くので、差分を継ぎ足さずそのまま置き換える。
      if (parsed.data.type === "data-reasoning") setReasoning(parsed.data.data.text);
      // proposal は state の pendingEdit で受け取るため、ここでは実行状況だけ畳む。
      if (parsed.data.type === "data-proposal") setActivity(null);
    },
    onFinish: () => setActivity(null),
    onError: () => setActivity(null),
  });

  const { messages, sendMessage, status, isStreaming } = chat;

  // 応答が終わったら実行状況の表示を消す（エラー・中断でも残さない）。
  useEffect(() => {
    if (status === "ready" || status === "error") setActivity(null);
  }, [status]);

  const loadArchivePage = useCallback(
    async (before?: string) => {
      if (loadingArchiveRef.current) return;
      loadingArchiveRef.current = true;
      try {
        const page = await getChatMessages(planId, { limit: ARCHIVE_PAGE_SIZE, before });
        setArchive((prev) => [...page.messages, ...prev]);
        setNextCursor(page.nextCursor);
        archiveLoadedRef.current = true;
      } catch {
        // 履歴の読み足しに失敗してもライブ会話は継続できるので黙って諦める。
      } finally {
        loadingArchiveRef.current = false;
      }
    },
    [planId],
  );

  /**
   * 認可失敗を検知してトークンの取り直しへ誘導する。
   *
   * ゲートに 401 で弾かれても partysocket は延々と再接続を試みる。放置すると
   * 接続の嵐でページが固まるため、「一度も open できないまま close が続いた」場合は
   * 失効とみなして呼び出し側へ通知する（呼び出し側はトークンを捨てて gate を出し直す）。
   * `agent.ready` は最初の試行の結果しか教えてくれないので、close を数える。
   */
  useEffect(() => {
    if (!onUnauthorized) return;

    let failures = 0;
    const onOpen = () => {
      failures = 0;
    };
    const onClose = () => {
      failures += 1;
      if (failures >= MAX_CONNECT_FAILURES) onUnauthorized();
    };

    agent.addEventListener("open", onOpen);
    agent.addEventListener("close", onClose);
    return () => {
      agent.removeEventListener("open", onOpen);
      agent.removeEventListener("close", onClose);
    };
  }, [agent, onUnauthorized]);

  const send = useCallback(
    (text: string) => {
      // 前のターンの思考はここで捨てる。応答の終了では消さないので、提案を眺めている間は
      // 「なぜこの案になったか」を開いて読める。
      setReasoning(null);
      sendMessage({ text });
    },
    [sendMessage],
  );

  const loadOlder = useCallback(() => {
    if (!archiveLoadedRef.current) {
      void loadArchivePage();
      return;
    }
    if (nextCursor) void loadArchivePage(nextCursor);
  }, [loadArchivePage, nextCursor]);

  /**
   * 修正を承認する。
   *
   * 適用の完了は state の `appliedVersion` でも届くが、それだけに頼らない。
   * RPC の応答が返らないケース（DO がチャットのターンで詰まっている等）でも
   * しおりが古いまま取り残されないよう、成否に関わらず再取得を促す。
   * 実際に書き換わったかどうかは、取り直した計画のバージョンが決める。
   */
  const applyEdit = useCallback(
    (id: string) => {
      void (async () => {
        try {
          await agent.stub.applyPlanEdit(id);
        } catch {
          // 応答が取れなくてもサーバ側では適用済みのことがある。再取得で確かめる。
        } finally {
          onPlanMaybeChanged?.();
        }
      })();
    },
    [agent, onPlanMaybeChanged],
  );

  const rejectEdit = useCallback(
    (id: string) => {
      void agent.stub.rejectPlanEdit(id);
    },
    [agent],
  );

  return {
    messages,
    send,
    isStreaming,
    activity,
    reasoning,
    rateLimit,
    state,
    applyEdit,
    rejectEdit,
    archive,
    hasMoreArchive: !archiveLoadedRef.current || nextCursor !== null,
    loadOlder,
  };
}
