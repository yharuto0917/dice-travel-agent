import type { HitlQuestion } from "@repo/shared";

/**
 * HITL（Human-in-the-loop）キューの純粋な操作ヘルパー群。
 * 状態（AgentState.questions）は不変更新し、Durable Object 側から呼ぶ。
 */

/** 新しい pending 質問を生成する。 */
export function makeQuestion(question: string, options?: string[]): HitlQuestion {
  return {
    id: crypto.randomUUID(),
    question,
    ...(options && options.length > 0 ? { options } : {}),
    answer: null,
    status: "pending",
  };
}

/** 未回答（pending）の質問だけを返す。 */
export function pendingQuestions(questions: HitlQuestion[]): HitlQuestion[] {
  return questions.filter((q) => q.status === "pending");
}

/** pending 質問が1件でもあるか。 */
export function hasPending(questions: HitlQuestion[]): boolean {
  return questions.some((q) => q.status === "pending");
}

/** id 一致の質問を answered にして回答を記録する（他は不変）。 */
export function answerInList(
  questions: HitlQuestion[],
  id: string,
  answer: string,
): HitlQuestion[] {
  return questions.map((q) => (q.id === id ? { ...q, answer, status: "answered" } : q));
}

/** id 一致の pending 質問を skipped にする（既に回答済みなら不変）。 */
export function skipInList(questions: HitlQuestion[], id: string): HitlQuestion[] {
  return questions.map((q) =>
    q.id === id && q.status === "pending" ? { ...q, status: "skipped" } : q,
  );
}

/** 指定 id 群の pending 質問をまとめて skipped にする（タイムアウト用）。 */
export function skipManyInList(questions: HitlQuestion[], ids: string[]): HitlQuestion[] {
  const set = new Set(ids);
  return questions.map((q) =>
    set.has(q.id) && q.status === "pending" ? { ...q, status: "skipped" } : q,
  );
}

/** answered の Q&A を「質問→回答」マップへ。再開時にプロンプトへ反映する。 */
export function answeredMap(questions: HitlQuestion[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const q of questions) {
    if (q.status === "answered" && q.answer) map[q.question] = q.answer;
  }
  return map;
}
