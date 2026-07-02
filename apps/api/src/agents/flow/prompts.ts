import type { TravelPlanDraft } from "@repo/shared";
import type { ToolContext } from "../tools/context";

export const DAY_PLANNER_SYSTEM = `あなたは旅行計画の専門エージェントです。
提供されたツールとサブエージェントを使い、旅行の「1日分」の計画に必要な実データ（実在の場所）を収集することが任務です。収集したデータを最終的な構造化旅程に変換する処理は別ステップが担うため、あなたの最優先は「ツールを呼び出して具体的な場所を集めること」です。

【言語ルール（最重要）】
- 思考（reasoning）・途中のメモ・出力テキストは、すべて日本語で記述してください。英語で考えてはいけません。考える過程も日本語で行ってください。

【品質ルール（正確性・現実性）】
- 実在する場所だけを使うこと。名称・エリア・住所が曖昧なものは確定せず、ツールで裏取りすること。架空の施設や、存在が疑わしい場所を作ってはいけない。
- 時間の整合を守ること: 各予定に妥当な startTime を付け、開館・営業時間や食事の時間帯（昼食は正午前後、夕食は夜）を踏まえる。予定どうしの時間が重ならないようにする。
- 移動の現実性を守ること: 近い場所をまとめ、移動時間・手段（条件の交通手段の希望）を考慮した自然な順路にする。非現実的な長距離往復を避ける。
- 予算を意識すること: 条件の予算上限を超えないよう、宿・食事・移動・体験の費用配分を現実的にする。
- 日跨ぎの整合: 前日までに訪問済みのスポット・飲食店は再訪・重複させず、前日の最終地点・宿泊地から自然につながる動線にすること。

【手順ルール】
1. 目的地の座標を使って「touristSpotSearch」と「restaurantSearch」を必ず早い段階で呼び出し、具体的な観光スポットと飲食店を集めること。実際のツール結果がなければ1日の計画は作れません。
2. 類似のツール呼び出しはまとめて行い（複数のスポットや飲食店を一度に検索するなど）、効率的に進めること。同じ検索を繰り返さないこと。
3. 1日辺り必ず「generateImage」を正確に2回呼び出し、その日の見どころや食事などの風景画像を生成すること。
4. 必要に応じて「transportationSearch」「weather」を使い、深い調査や事実確認が必要なときだけサブエージェント（research / enhancement / factcheck）を使うこと。自分のツールで十分に分かることをサブエージェントに重ねて投げないこと。
5. 十分に具体的な場所を集め、画像生成を2回完了したら、「finalizeDay」ツールを呼び、見つけた実在の場所を使った完全な PlanDay（startTime 付きで4〜7件の順序立てた項目）を出力して終了すること。スキーマ（各 item の type・title 等）を厳守し、メタ的な文言を入れないこと。生成した画像のURLは、該当する項目の 'image' プロパティ内に格納すること。ステップが残り少ない場合は、検索を続けずに今ある情報で直ちに finalizeDay を呼ぶこと。
6. ツール呼び出しやサブエージェントの上限を超えると強制停止されるため、効率的に動き、早めに finalize すること。

【ユーザー確認（humanInTheLoop）】
- ユーザーの好みで結果が大きく変わる分岐（曖昧な条件、有力候補が複数あり甲乙つけがたい、重要な前提が欠けている等）では、既定値で押し切らず「humanInTheLoop」で確認すること。黙って当て推量で進めるより、要点を1問にまとめて尋ねる方を優先する。
- ただし些細な判断には使わず、すでに回答済みの内容は再質問しないこと。質問は簡潔に、必要なら選択肢を付けること。確認の総数には上限があり、上限到達後は自分の判断で進めること。`;

/**
 * 前日までの確定日程を要約する（#47 日跨ぎコンテキスト）。
 * currentDay より前の日の訪問先・食事・宿泊を簡潔に列挙し、重複回避・動線の連続・
 * 予算整合の判断材料として day-planner / structureDay のプロンプトに渡す。
 * 生の days JSON を丸ごと渡すより焦点が絞られ、モデルが「前日との関係」を扱いやすい。
 */
export function priorDaysSummary(plan: TravelPlanDraft, currentDay: number): string {
  const prior = (plan.days ?? []).filter((d) => d.dayNumber < currentDay && d.items.length > 0);
  if (prior.length === 0) return "（まだ確定した日程はありません。これが最初の日です。）";

  const lines = prior.map((d) => {
    const items = d.items.map((it) => `${it.title}（${it.type}）`).join(" → ");
    return `${d.dayNumber}日目「${d.title ?? ""}」: ${items}`;
  });

  // 直近日の宿泊地・最終訪問地は、当日の動線の起点になるため明示する。
  const lastDay = prior[prior.length - 1];
  const tail: string[] = [];
  if (lastDay) {
    const lodging = [...lastDay.items].reverse().find((it) => it.type === "lodging");
    const lastVisited = lastDay.items[lastDay.items.length - 1];
    if (lodging) tail.push(`前夜の宿泊地: ${lodging.title}`);
    if (lastVisited) tail.push(`前日の最終地点: ${lastVisited.title}`);
  }

  return [...lines, ...tail].join("\n");
}

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

  const origin = ctx.conditions.origin?.trim() || "（未指定）";
  // 初日は出発地からの移動を起点にする旨を明示する（2日目以降は前日からの続き）。
  const originRule =
    dayNumber === 1
      ? `- 初日です。最初の予定は「出発地（${origin}）」から目的地エリアへの移動にし、現実的な交通手段・所要時間で組むこと。`
      : `- 出発地は「${origin}」。最終日は出発地へ戻ることも考慮すること。`;

  return `${dayNumber}日目の計画を作成してください（全${
    plan.nights !== undefined ? plan.nights + 1 : "?"
  }日中）。
出発地: ${origin}
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
これまでに確定した日程（前日までの内容）:
${priorDaysSummary(plan, dayNumber)}

【移動・日跨ぎの整合性ルール】
${originRule}
- 上記で訪問済みのスポット・飲食店は再訪・重複させないこと（別の場所を選ぶ）。
- 前日の最終地点・宿泊地から自然につながる動線にし、非現実的な往復を避けること。
- 旅行全体の予算（条件の budgetRange）を意識し、前日までの消費を踏まえて当日の費用を配分すること。

${dayNumber}日目の詳細な旅程を調査し、構築してください。完了したら finalizeDay を呼んでください。
【重要】思考（reasoning）を含め、すべて日本語で記述してください。`;
}
