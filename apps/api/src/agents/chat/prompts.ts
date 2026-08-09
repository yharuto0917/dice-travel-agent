import type { PlanItem, TravelPlan } from "@repo/shared";

/**
 * 常駐チャット（#20）のプロンプト。
 *
 * 計画生成の day-planner（`flow/prompts.ts`）と違い、ここでは「確定済みの計画を前提に
 * 会話する」。計画本文をそのまま JSON で渡すと文脈を食い潰すので、会話に必要な粒度へ
 * 圧縮した要約を渡す。すべて純関数にしてテストできるようにする。
 */

/** 計画要約に載せる1日あたりの予定件数の上限。長い旅程でも文脈を膨らませない。 */
const MAX_ITEMS_PER_DAY = 12;

/** 旧データの長文説明で会話コンテキストを圧迫しないための1予定あたり上限。 */
const MAX_ITEM_DETAIL_LEN = 240;

function compactDetail(value: string, max: number = MAX_ITEM_DETAIL_LEN): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > max ? `${compacted.slice(0, max)}…` : compacted;
}

/** 質問回答に必要な予定の保存済み詳細を、1行へ圧縮して表す。 */
function itemSummary(item: PlanItem): string {
  const time = item.startTime ? `${item.startTime} ` : "";
  const details = [`種別=${item.type}`];
  if (item.location) {
    const location = [item.location.name, item.location.address]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => compactDetail(value, 120))
      .join(" / ");
    if (location) details.push(`場所=${location}`);
  }
  if (item.durationMin != null) details.push(`所要=${item.durationMin}分`);
  if (item.cost) {
    details.push(`費用=${item.cost.approx ? "約" : ""}${item.cost.amount}円`);
  }
  if (item.description) details.push(`説明=${compactDetail(item.description)}`);
  return `  - ${time}${compactDetail(item.title, 120)}（${details.join(" / ")}）`;
}

/**
 * 会話・質問応答の共通ルール。
 *
 * 言語ルールを「最重要」として先頭に置き、思考（reasoning）まで日本語で書かせる。
 * 思考は UI に折りたたみ表示されるので、英語で考えられると利用者が読めない。
 * 計画生成の `flow/prompts.ts` で効いている書き方に合わせている。
 */
const COMMON_RULES = `【言語ルール（最重要）】
- 思考（reasoning）・途中のメモ・出力テキストは、すべて日本語で記述してください。英語で考えてはいけません。考える過程も日本語で行ってください。

【回答ルール】
- 回答は簡潔にすること。長い前置き・自己紹介・定型の締めくくりを書かない。
- 計画に書かれていることは計画から答え、書かれていないことは推測で断定しない。
- 現地の最新情報（営業時間・料金・天気・経路など）が必要なときだけツールを使うこと。同じ検索を繰り返さない。`;

/** 旅程を会話用に圧縮したテキストへ変換する。 */
export function planSummary(plan: TravelPlan): string {
  const lines: string[] = [
    `タイトル: ${plan.title}`,
    `目的地: ${plan.destination.prefecture}`,
    `日程: ${plan.nights === 0 ? "日帰り" : `${plan.nights}泊${plan.nights + 1}日`}`,
  ];
  if (plan.summary) lines.push(`概要: ${plan.summary}`);
  if (plan.budget?.total) lines.push(`予算の目安: ${plan.budget.total.amount}円`);

  const conditions = plan.conditions;
  const conditionParts: string[] = [];
  if (conditions.origin) conditionParts.push(`出発地=${conditions.origin}`);
  if (conditions.partySize) conditionParts.push(`人数=${conditions.partySize}名`);
  if (conditions.themes?.length) conditionParts.push(`テーマ=${conditions.themes.join("・")}`);
  if (conditions.budgetRange) {
    conditionParts.push(`予算帯=${conditions.budgetRange[0]}〜${conditions.budgetRange[1]}円/人`);
  }
  if (conditions.customRequests) conditionParts.push(`要望=${conditions.customRequests}`);
  if (conditionParts.length > 0) lines.push(`条件: ${conditionParts.join(" / ")}`);

  for (const day of plan.days) {
    const items = day.items.slice(0, MAX_ITEMS_PER_DAY).map(itemSummary).join("\n");
    const omitted =
      day.items.length > MAX_ITEMS_PER_DAY
        ? `\n  - …ほか${day.items.length - MAX_ITEMS_PER_DAY}件`
        : "";
    lines.push(`${day.dayNumber}日目「${day.title ?? ""}」\n${items}${omitted}`);
  }

  return lines.join("\n");
}

/**
 * 質問応答（QAループ）のシステムプロンプト。
 *
 * 言語ルールは冒頭（{@link COMMON_RULES}）と末尾の2箇所に置く。計画生成の
 * `dayPlannerPrompt` と同じ形で、長い計画要約を挟んだあとでも指示が薄れないようにする。
 */
export function answerSystemPrompt(plan: TravelPlan): string {
  return `あなたは、確定済みの旅行計画について利用者の質問に答える旅のコンシェルジュです。

${COMMON_RULES}

現在の旅行計画:
${planSummary(plan)}

【重要】思考（reasoning）を含め、すべて日本語で記述してください。`;
}

/** 旅行と無関係な発話へ返す誘導文（LLM を呼ばずに返す）。 */
export const OFF_TOPIC_REPLY =
  "旅行計画についてのご質問や、旅程の修正のご相談を承っています。「2日目の昼食はどこ？」「3日目を温泉中心に変えて」のようにお聞きください。";

/** 意図判定のシステムプロンプト。 */
export function intentSystemPrompt(plan: TravelPlan): string {
  return `あなたは旅行チャットの発話を分類する担当です。利用者の最新の発話を、次のいずれかに分類してください。

- edit: 旅程を変更・追加・削除してほしいという指示（例:「2日目を温泉中心にして」「昼食をもっと安い店に」）
- question: 旅程や現地の情報についての質問（例:「2日目の昼食はどこ？」「雨だったらどうする？」）
- other: 旅行計画と無関係な発話

判定のルール:
- 「それ」「その店」など指示語を含む発話は、直前までの会話を踏まえて解釈すること。
- edit と判定した場合は、変更対象の日番号を dayNumbers に列挙すること（1〜${plan.days.length}）。
- 対象の日が発話から特定できない全体的な修正なら dayNumbers は空配列にすること。

現在の旅行計画:
${planSummary(plan)}`;
}

/**
 * 修正案生成（編集ループ）のシステムプロンプト。
 *
 * 箇条書きで規則を積み上げた長い指示にすると、Gemini が指示文そのものを `startTime` などの
 * フィールドへ流し込む degeneration を高い頻度で起こす（実測でほぼ全滅した）。
 * 既に安定して動いている `validation/fix.ts` の `fillEmptyDays` と同じく、
 * 1段落に圧縮した指示にすることで生成が安定する。長くしないこと。
 */
export const EDIT_SYSTEM =
  'あなたは旅行の1日分の旅程を組み立てる専門家です。利用者の指示に沿って、指定された日を作り直してください。実在する場所だけを使い、妥当な startTime と description（何をするかが分かる1〜2文）を付けた4〜7件の順序立てた予定にしてください。同じ予定を繰り返してはいけません。指示に関係のない予定はできるだけそのまま残し、前日の最終地点からの動線が不自然にならないようにしてください。すべての自然言語フィールドは日本語で記述し、値以外の説明文をフィールドに混ぜないでください。startTime は "HH:mm" 形式のみ。items を空にしてはいけません。';

/**
 * 修正案の下調べ（リサーチ相, #20）のシステムプロンプト。
 *
 * 構造化生成（`generateObject`）はツールを呼べないので、実在情報の収集はこの前段に寄せる。
 * ここでの出力は旅程そのものではなく「後段が引く材料」なので、候補の列挙に徹させる。
 */
export const EDIT_RESEARCH_SYSTEM = `あなたは旅行の1日分を作り直すための下調べ担当です。利用者の指示を満たすのに必要な情報だけをツールで調べ、実在し現在も営業・公開している候補を箇条書きで挙げてください。旅程そのもの（時刻付きの並び）は作らないこと。候補ごとに「名称／エリア／指示に合う理由（1行）」を書き、営業時間・料金・所要時間・移動手段が分かった場合のみ併記してください。存在が確かめられないものは書かないこと。同じ検索を繰り返さず、必要がなければツールを使わずに終えてよい。思考（reasoning）を含め、すべて日本語で記述し、前置きや締めの挨拶は書かないこと。`;

/** 修正案の下調べのプロンプト（対象1日分）。 */
export function editResearchPrompt(
  plan: TravelPlan,
  dayNumber: number,
  instruction: string,
): string {
  const target = plan.days.find((d) => d.dayNumber === dayNumber);
  const current =
    target && target.items.length > 0
      ? target.items
          .slice(0, MAX_ITEMS_PER_DAY)
          .map((item) => `  - ${item.title}（${item.type}）`)
          .join("\n")
      : "  （まだ予定がありません）";

  return `${dayNumber}日目を次の指示に沿って作り直します。作り直しに使う候補を調べてください。

利用者の指示:
${instruction}

現在の${dayNumber}日目:
${current}

行き先: ${plan.destination.prefecture}
旅行全体のコンテキスト:
${planSummary(plan)}

【重要】思考（reasoning）を含め、すべて日本語で記述してください。`;
}

/**
 * 現在の日程を修正案生成へ見せる前に `image` を落とす。
 *
 * 画像 URL はランダム UUID を含む R2 の配信 URL で、モデルには意味が無いうえ
 * 「それらしい別の URL」を作る材料になる。画像の引き継ぎ・新規生成は `edit.ts` が
 * コード側で決定的に行うので、プロンプトからは丸ごと外す。
 */
function stripImages(day: TravelPlan["days"][number]): TravelPlan["days"][number] {
  return {
    ...day,
    items: day.items.map(({ image: _image, ...item }) => item),
  };
}

/**
 * 修正案生成のプロンプト（対象1日分）。
 *
 * `notes` はリサーチ相がツールで集めた候補メモ。実在の店舗・施設をここから引かせることで、
 * モデルの記憶だけに頼った架空スポットの混入を減らす。
 */
export function editDayPrompt(
  plan: TravelPlan,
  dayNumber: number,
  instruction: string,
  notes?: string | null,
): string {
  const target = plan.days.find((d) => d.dayNumber === dayNumber);
  const currentDay = target
    ? JSON.stringify(stripImages(target), null, 2)
    : "（この日はまだ予定がありません。新しく作成してください。）";

  const research = notes
    ? `\n\n下調べで見つかった候補（実在確認済み。ここから優先して選ぶこと。合わないものは使わなくてよい）:\n${notes}`
    : "";

  return `${dayNumber}日目を、次の指示に沿って作り直してください。

利用者の指示:
${instruction}

現在の${dayNumber}日目:
${currentDay}

旅行全体のコンテキスト:
${planSummary(plan)}${research}`;
}

/**
 * 修正内容の説明文（差分プレビューの見出し）を作らせるプロンプト。
 *
 * 文字数の指定を明示すると「（24文字）」のような注記を本文へ書き足してくるため、
 * 上限は「短く」という指示に留め、余計な補足を書かないことを明示する。
 */
export function editSummaryPrompt(instruction: string, dayNumbers: number[]): string {
  return `次の修正指示に対して行った変更を、短い日本語1文で要約してください。見出しとして表示するので、前置き・装飾・文字数などの補足は一切書かないこと。

対象: ${dayNumbers.map((n) => `${n}日目`).join("・")}
指示: ${instruction}`;
}
