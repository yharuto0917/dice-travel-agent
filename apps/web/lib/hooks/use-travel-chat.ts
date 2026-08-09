"use client";

import { useAgentChat } from "@cloudflare/ai-chat/react";
import {
  CHAT_HISTORY_MAX_BOUNDARY_IDS,
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
  /**
   * 古い履歴を1ページ読み足す。実際に読み込みを開始したときだけ true。
   * 呼び出し側（`Conversation`）はこの戻り値でスクロール位置の保存要否を決める。
   */
  loadOlder: () => boolean;
}

/**
 * 初回ページの境界候補（live message の id を古い順）。
 *
 * 最古の1件だけでは、それが D1 にアーカイブされていない場合（中断された assistant 発話・
 * 計画未完成時の user 発話）にサーバが境界を解決できず、最新ページが返ってしまう。
 * 候補を複数渡し、D1 に実在する最も古い1件をサーバに選ばせる。
 */
function boundaryIds(messages: UIMessage[]): string[] {
  return messages.slice(0, CHAT_HISTORY_MAX_BOUNDARY_IDS).map((message) => message.id);
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
    // 接続許可は API origin の plan 専用 HttpOnly Cookie が WebSocket handshake に付く。
    // URL へ token を載せないため、ログや履歴へ資格情報を残さない。
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
    async (before?: string, beforeIds?: string[]) => {
      if (loadingArchiveRef.current) return;
      loadingArchiveRef.current = true;
      try {
        const page = await getChatMessages(planId, {
          limit: ARCHIVE_PAGE_SIZE,
          before,
          beforeMessageIds: beforeIds,
        });
        setArchive((prev) => {
          const known = new Set(prev.map((message) => message.id));
          return [...page.messages.filter((message) => !known.has(message.id)), ...prev];
        });
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

  const loadOlder = useCallback((): boolean => {
    if (loadingArchiveRef.current) return false;
    if (!archiveLoadedRef.current) {
      if (messages.length === 0) return false;
      void loadArchivePage(undefined, boundaryIds(messages));
      return true;
    }
    if (!nextCursor) return false;
    void loadArchivePage(nextCursor);
    return true;
  }, [loadArchivePage, messages, nextCursor]);

  // DO の履歴同期が完了したら、最古の live message より前を初回ページとして先読みする。
  // 会話が短くスクロール領域ができない場合でも、過去履歴を表示できる。
  useEffect(() => {
    // status は接続直後から ready になり得る。messages が空の時点で D1 の最新ページを読むと
    // 後から同期された live 履歴と全件重複するため、最古 id が確定するまで待つ。
    if (
      status !== "ready" ||
      messages.length === 0 ||
      archiveLoadedRef.current ||
      loadingArchiveRef.current
    ) {
      return;
    }
    void loadArchivePage(undefined, boundaryIds(messages));
  }, [loadArchivePage, messages, status]);

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
