import type { HitlQuestion } from "@repo/shared";
import { describe, expect, it } from "vitest";
import {
  answeredMap,
  answerInList,
  hasPending,
  makeQuestion,
  pendingQuestions,
  skipInList,
  skipManyInList,
} from "./questions";

describe("hitl/questions", () => {
  it("makeQuestion creates a pending question with id", () => {
    const q = makeQuestion("行き先の優先度は？", ["温泉", "グルメ"]);
    expect(typeof q.id).toBe("string");
    expect(q.id.length).toBeGreaterThan(0);
    expect(q.status).toBe("pending");
    expect(q.answer).toBeNull();
    expect(q.options).toEqual(["温泉", "グルメ"]);
  });

  it("makeQuestion omits options when empty", () => {
    const q = makeQuestion("自由記述の質問");
    expect(q.options).toBeUndefined();
  });

  it("pendingQuestions / hasPending filter by status", () => {
    const qs: HitlQuestion[] = [
      { id: "a", question: "q1", answer: null, status: "pending" },
      { id: "b", question: "q2", answer: "x", status: "answered" },
      { id: "c", question: "q3", answer: null, status: "skipped" },
    ];
    expect(pendingQuestions(qs).map((q) => q.id)).toEqual(["a"]);
    expect(hasPending(qs)).toBe(true);
    expect(hasPending(qs.filter((q) => q.status !== "pending"))).toBe(false);
  });

  it("answerInList marks a single question answered without touching others", () => {
    const qs: HitlQuestion[] = [
      { id: "a", question: "q1", answer: null, status: "pending" },
      { id: "b", question: "q2", answer: null, status: "pending" },
    ];
    const next = answerInList(qs, "a", "回答");
    expect(next[0]).toMatchObject({ answer: "回答", status: "answered" });
    expect(next[1]).toMatchObject({ answer: null, status: "pending" });
  });

  it("skipInList only skips pending questions", () => {
    const qs: HitlQuestion[] = [
      { id: "a", question: "q1", answer: "x", status: "answered" },
      { id: "b", question: "q2", answer: null, status: "pending" },
    ];
    const next = skipInList(qs, "a");
    expect(next.find((q) => q.id === "a")?.status).toBe("answered"); // 既回答は不変
    expect(skipInList(qs, "b").find((q) => q.id === "b")?.status).toBe("skipped");
  });

  it("skipManyInList skips all listed pending ids", () => {
    const qs: HitlQuestion[] = [
      { id: "a", question: "q1", answer: null, status: "pending" },
      { id: "b", question: "q2", answer: null, status: "pending" },
      { id: "c", question: "q3", answer: "x", status: "answered" },
    ];
    const next = skipManyInList(qs, ["a", "b", "c"]);
    expect(next.map((q) => q.status)).toEqual(["skipped", "skipped", "answered"]);
  });

  it("answeredMap maps question text to answer for answered only", () => {
    const qs: HitlQuestion[] = [
      { id: "a", question: "予算は？", answer: "5万円", status: "answered" },
      { id: "b", question: "未回答", answer: null, status: "pending" },
    ];
    expect(answeredMap(qs)).toEqual({ "予算は？": "5万円" });
  });
});
