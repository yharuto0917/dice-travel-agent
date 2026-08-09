import type { MessageConcurrency } from "agents/chat";

/** 応答中の後続 submit を永続化前に拒否し、発話と応答の対応を崩さない。 */
export const CHAT_MESSAGE_CONCURRENCY = "drop" satisfies MessageConcurrency;
