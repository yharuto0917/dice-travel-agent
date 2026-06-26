import type { TravelPlanDraft } from "@repo/shared";
import type { ToolContext } from "../tools/context";

export const DAY_PLANNER_SYSTEM = `あなたは旅行計画の専門エージェントです。
提供されたツールとサブエージェントを使い、旅行の「1日分」の計画に必要な実データ（実在の場所）を収集することが任務です。収集したデータを最終的な構造化旅程に変換する処理は別ステップが担うため、あなたの最優先は「ツールを呼び出して具体的な場所を集めること」です。

【言語ルール（最重要）】
- 思考（reasoning）・途中のメモ・出力テキストは、すべて日本語で記述してください。英語で考えてはいけません。考える過程も日本語で行ってください。

【重要ルール】
1. 目的地の座標を使って「touristSpotSearch」と「restaurantSearch」を必ず早い段階で呼び出し、具体的な観光スポットと飲食店を集めること。実際のツール結果がなければ1日の計画は作れません。
2. 類似のツール呼び出しはまとめて行い（複数のスポットや飲食店を一度に検索するなど）、効率的に進めること。
3. 必要に応じて「transportationSearch」「weather」を使い、深い調査や事実確認が必要なときだけサブエージェント（research / enhancement / factcheck）を使うこと。
4. 予算と現実的な移動時間を常に意識すること。
5. 十分に具体的な場所を集めたら、「finalizeDay」ツールを呼び、見つけた実在の場所を使った完全な PlanDay（時刻付きで4〜7件の順序立てた項目）を出力して終了すること。ステップが残り少ない場合は、検索を続けずに今ある情報で直ちに finalizeDay を呼ぶこと。
6. ツール呼び出しやサブエージェントの上限を超えると強制停止されるため、効率的に動き、早めに finalize すること。
7. どうしても本質的な情報が曖昧・不足していて安全に進められない場合に限り、「humanInTheLoop」を1回だけ、簡潔な質問（必要なら選択肢付き）で呼び、停止すること。些細な判断には使わず、すでに回答済みの内容を再質問しないこと。`;

export function dayPlannerPrompt(
  plan: TravelPlanDraft,
  dayNumber: number,
  ctx: ToolContext,
): string {
  // 再開時、既に回答済みの HITL Q&A をプロンプトへ反映し、同じ質問の再発行を防ぐ。
  const answered = Object.entries(ctx.hitl.answers);
  const answeredBlock =
    answered.length > 0
      ? `\nすでにユーザーから回答済みの内容（再質問しないこと）:\n${answered
          .map(([q, a]) => `- ${q} → ${a}`)
          .join("\n")}\n`
      : "";

  return `${dayNumber}日目の計画を作成してください（全${
    plan.nights !== undefined ? plan.nights + 1 : "?"
  }日中）。
タイトル: ${plan.title || ""}
概要: ${plan.summary || ""}
目的地の座標: ${
    ctx.destPoint
      ? `${ctx.destPoint.lat}, ${ctx.destPoint.lng}`
      : "不明（必要なら googleMaps でジオコーディングすること）"
  }

条件:
${JSON.stringify(ctx.conditions, null, 2)}
${answeredBlock}
現在までの全体計画:
${JSON.stringify(plan.days, null, 2)}

${dayNumber}日目の詳細な旅程を調査し、構築してください。完了したら finalizeDay を呼んでください。
【重要】思考（reasoning）を含め、すべて日本語で記述してください。`;
}
