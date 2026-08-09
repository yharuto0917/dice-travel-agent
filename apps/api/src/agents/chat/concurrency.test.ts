import { SubmitConcurrencyController } from "agents/chat";
import { describe, expect, it } from "vitest";
import { CHAT_MESSAGE_CONCURRENCY } from "./concurrency";

describe("chat message concurrency", () => {
  it("先行 submit の永続化中に届いた後続 submit を drop する", () => {
    const controller = new SubmitConcurrencyController({ defaultDebounceMs: 250 });
    // 先行ターンは admission 済みだが、まだ turn queue へ登録されていない競合窓を再現する。
    const release = controller.beginEnqueue();
    try {
      const decision = controller.decide({
        concurrency: CHAT_MESSAGE_CONCURRENCY,
        isSubmitMessage: true,
        queuedTurns: 0,
      });
      expect(decision.action).toBe("drop");
    } finally {
      release();
    }
  });
});
