import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { normalizeClassification, recentHistory } from "./intent";

describe("chat/intent normalizeClassification", () => {
  it("edit 以外では日番号を持たせない", () => {
    expect(normalizeClassification({ intent: "question", dayNumbers: [1, 2] }, 3)).toEqual({
      intent: "question",
      dayNumbers: [],
    });
    expect(normalizeClassification({ intent: "other", dayNumbers: [1] }, 3)).toEqual({
      intent: "other",
      dayNumbers: [],
    });
  });

  it("計画の日数の範囲外の日番号を捨てる", () => {
    // LLM は 0 や存在しない日をしばしば返す。そのまま編集へ渡すと存在しない日を作ってしまう。
    expect(normalizeClassification({ intent: "edit", dayNumbers: [0, 1, 4, -2] }, 3)).toEqual({
      intent: "edit",
      dayNumbers: [1],
    });
  });

  it("重複を除き昇順へ整える", () => {
    expect(normalizeClassification({ intent: "edit", dayNumbers: [3, 1, 3, 2] }, 3)).toEqual({
      intent: "edit",
      dayNumbers: [1, 2, 3],
    });
  });

  it("小数は切り捨てて整数の日番号として扱う", () => {
    expect(normalizeClassification({ intent: "edit", dayNumbers: [2.7] }, 3)).toEqual({
      intent: "edit",
      dayNumbers: [2],
    });
  });

  it("dayNumbers 未指定は空配列（全体的な修正の合図）にする", () => {
    expect(normalizeClassification({ intent: "edit" }, 3)).toEqual({
      intent: "edit",
      dayNumbers: [],
    });
  });
});

describe("chat/intent recentHistory", () => {
  const msgs: ModelMessage[] = [
    { role: "user", content: "1日目の宿は？" },
    { role: "assistant", content: "御宿 東鳳です" },
    { role: "user", content: "2日目の移動は？" },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "t1", toolName: "googleMaps", input: {} }],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "t1",
          toolName: "googleMaps",
          output: { type: "json", value: {} },
        },
      ],
    },
    { role: "assistant", content: "電車です" },
    { role: "user", content: "2日目を温泉中心に変えて" },
  ];

  it("窓がツール呼び出しの途中から始まらないよう、先頭を user 発話まで捨てる", () => {
    // assistant の functionCall から始まる履歴を渡すと Gemini が 400 を返し、
    // 意図判定が失敗して修正指示がすべて質問として扱われてしまう。
    const history = recentHistory(msgs, 4);
    expect(history[0]?.role).toBe("user");
    expect(history.at(-1)?.content).toBe("2日目を温泉中心に変えて");
  });

  it("窓に user 発話が無ければ、判定対象の最新 user 発話だけを渡す", () => {
    const toolOnly: ModelMessage[] = [
      msgs[0] as ModelMessage,
      msgs[3] as ModelMessage,
      msgs[4] as ModelMessage,
    ];
    expect(recentHistory(toolOnly, 2)).toEqual([msgs[0]]);
  });

  it("履歴が上限より短ければそのまま使う", () => {
    expect(recentHistory(msgs.slice(0, 2), 6)).toEqual(msgs.slice(0, 2));
  });
});
