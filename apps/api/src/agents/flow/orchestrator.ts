import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { google } from "@ai-sdk/google";
import type {
  HitlQuestion,
  PlanDay,
  PlanItem,
  TimelineEventKind,
  TimelineEventStatus,
  TravelPlanDraft,
} from "@repo/shared";
import { PlanDayGenSchema } from "@repo/shared";
import { generateObject, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import type { Bindings } from "../../env";
import { createLlm, SUPERVISOR_MODEL_ID } from "../llm/provider";
import { buildSubagents } from "../subagents";
import { buildTools } from "../tools";
import type { GeneratedImage, ToolContext } from "../tools/context";
import { generateItemImage } from "../tools/generate-image";
import { buildHumanInTheLoop } from "../tools/human-in-the-loop";
import { MAX_STEPS, shouldStopUsageLimit } from "./judgement";
import { DAY_PLANNER_SYSTEM, dayPlannerPrompt, priorDaysSummary } from "./prompts";

/**
 * runDay の結果。通常は確定した PlanDay を返すが、計画担当が `humanInTheLoop` を
 * 呼んだ場合は HITL 中断として pending 質問を返す（DO が awaiting_user へ遷移する）。
 */
export type RunDayResult =
  | { status: "ok"; day: PlanDay }
  | { status: "hitl"; questions: HitlQuestion[] };

/**
 * 実行状況を UI へ通知するコールバック。
 * status は AgentState.activity（実行状況の一行）、thought は AgentState.thought
 * （思考中の要約テキスト末尾）に対応。thought 省略時は思考表示をクリアする。
 */
export type ActivityCallback = (status: string, thought?: string | null) => void;

/**
 * 実行履歴イベントの通知（#47 可観測性）。orchestrator は id/at/dayNumber を持たない
 * 「種別・ラベル・状態・groupId・detail」だけを発行し、Agent 側が id/時刻/日番号を付与して
 * AgentState.timeline に追記する。長時間処理は同一 groupId の start→done で対にする。
 */
export type TimelineInput = {
  kind: TimelineEventKind;
  label: string;
  status?: TimelineEventStatus;
  groupId?: string | null;
  detail?: string | null;
};
export type TimelineCallback = (event: TimelineInput) => void;

/** サブエージェントのツール名（タイムライン上で kind="subagent" として可視化する）。 */
const SUBAGENT_NAMES = new Set(["research", "enhancement", "factcheck", "summarize"]);

/**
 * ツール名 → 表示ラベル。組み込みの Google 検索はプロバイダ実行ツールのため
 * "server:GOOGLE_SEARCH_WEB" 等の名前で届く。TOOL_LABELS に一致しなければ正規化して当てる。
 */
function toolLabel(toolName: string): string {
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName];
  const lower = toolName.toLowerCase();
  if (
    lower.includes("google_search") ||
    lower.includes("search_web") ||
    lower.includes("googlesearch")
  ) {
    return TOOL_LABELS.google_search ?? "Web で調べています";
  }
  return `${toolName} を実行しています`;
}

/** 思考要約の末尾だけを表示用に切り出す（空白正規化 + 末尾 max 文字）。 */
function reasoningTail(s: string, max = 200): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
}

/** タイムラインに残す「終わった思考」の本文上限。DO state 同期の肥大を防ぐため切り詰める。 */
const MAX_THOUGHT_DETAIL = 2000;

/** 構造化(当日 items 生成)の出力上限。1日分の itinerary を収めつつ退行を短時間で打ち切る。 */
const STRUCTURE_MAX_OUTPUT_TOKENS = 4096;
/** サニタイズ時の最大文字数（タイトル/説明）。退行で混入した巨大文字列を切り詰める。 */
const MAX_TITLE_LEN = 120;
const MAX_DESC_LEN = 800;

function clampText(s: string | undefined, max: number): string | undefined {
  if (s === undefined) return undefined;
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

/**
 * 生成された PlanDay の文字列フィールドを安全長に切り詰める。LLM の退行で混入した
 * 巨大な run-on 文字列がそのまま title/description に残るのを防ぐ防御層。
 */
function sanitizeDay(day: PlanDay): PlanDay {
  return {
    ...day,
    title: clampText(day.title, MAX_TITLE_LEN),
    items: day.items.map((item) => ({
      ...item,
      title: clampText(item.title, MAX_TITLE_LEN) ?? item.title,
      description: clampText(item.description, MAX_DESC_LEN),
    })),
  };
}

/** 画像を生成する対象の種別。観光名所（観光スポット `spot`）のみに限定する（#18）。 */
const IMAGE_TARGET_TYPES: ReadonlySet<PlanItem["type"]> = new Set(["spot"]);

/** 各日の生成枚数の上限（コスト・レイテンシの上限）。 */
const MAX_IMAGES_PER_DAY = 6;

/**
 * 画像を生成する対象アイテムを選ぶ（#18）。
 *
 * 観光名所（{@link IMAGE_TARGET_TYPES} = `spot`）のうち、まだ image を持たないものを上限まで採る。
 * 食事・宿・移動・体験・自由時間には生成しない。観光名所を1件も含まない日は画像なしになる。
 */
export function selectImageTargets(items: PlanItem[]): { index: number; item: PlanItem }[] {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.image && IMAGE_TARGET_TYPES.has(item.type))
    .slice(0, MAX_IMAGES_PER_DAY);
}

/**
 * 画像生成の主題を組み立てる（#18）。具体的な場所名があれば優先し、目的地名で補強する。
 * これを generateItemImage が写真向けの英語プロンプトへ包む。
 */
export function imageSubject(item: PlanItem, destinationName: string | null): string {
  const base = (item.location?.name?.trim() || item.title).trim();
  return destinationName ? `${base}（${destinationName}）` : base;
}

/**
 * 日の構造化後に、観光名所へ内容一致の風景画像を**決定的に**生成・埋め込む（#18）。
 *
 * かつては LLM が `generateImage` ツールを呼ぶ設計だったが、ステップ上限との競合や
 * URL（ランダム UUID）の転記失敗で「安定して出ない／貼り付け先と内容が不一致」だった。
 * ここでは LLM のツール呼び出しに依存せず、観光名所（`spot`）のタイトル・場所名から画像を
 * 並列生成する（上限 {@link MAX_IMAGES_PER_DAY} 枚）。観光名所が無い日は生成しない。
 */
async function generateDayImages(
  env: Bindings,
  plan: TravelPlanDraft,
  day: PlanDay,
  onActivity?: ActivityCallback,
): Promise<PlanDay> {
  const targets = selectImageTargets(day.items);
  if (targets.length === 0) return day;

  onActivity?.("風景画像を生成しています…");
  // setup ステップで title は "${目的地}の旅" 形式。末尾の "の旅" を落として目的地名を得る。
  const destinationName = plan.title?.replace(/の旅$/, "").trim() || null;

  const generated = await Promise.all(
    targets.map((t) => generateItemImage(env, imageSubject(t.item, destinationName))),
  );

  const byIndex = new Map<number, GeneratedImage>();
  targets.forEach((t, k) => {
    const img = generated[k];
    if (img) byIndex.set(t.index, img);
  });
  if (byIndex.size === 0) return day;

  const items = day.items.map((item, index) => {
    const img = byIndex.get(index);
    return img ? { ...item, image: { url: img.url, alt: img.prompt, generated: true } } : item;
  });
  return { ...day, items };
}

/** ツール名 → 日本語の実行状況ラベル。ストリーミング中の表示に使う。 */
const TOOL_LABELS: Record<string, string> = {
  touristSpotSearch: "観光スポットを検索しています",
  hotelSearch: "宿を探しています",
  restaurantSearch: "飲食店を探しています",
  transportationSearch: "移動経路を調べています",
  weather: "天気を確認しています",
  imageSearch: "画像を探しています",
  googleMaps: "地図で位置を確認しています",
  calculate: "予算・距離を計算しています",
  google_search: "Web で調べています",
  research: "行き先を詳しく調査しています",
  enhancement: "説明を充実させています",
  factcheck: "整合性を検証しています",
  summarize: "要約をまとめています",
  humanInTheLoop: "確認事項を準備しています",
  finalizeDay: "この日の予定を確定しています",
};

export async function runDay(
  env: Bindings,
  ctx: ToolContext,
  plan: TravelPlanDraft,
  n: number,
  onActivity?: ActivityCallback,
  onEvent?: TimelineCallback,
): Promise<RunDayResult> {
  let finalizedDay: PlanDay | null = null;

  const finalizeDay = tool({
    description: "Finalize the day plan and output the complete PlanDay structure.",
    // フラットな生成スキーマ（anyOf 回避）。union のままだと day-planner が items を
    // 空配列で finalizeDay を呼び、その日の旅程が空になる。
    inputSchema: z.object({
      day: PlanDayGenSchema,
    }),
    execute: async ({ day }) => {
      // 生成スキーマ → 保存スキーマ。type により union のいずれかを満たすため実体は互換。
      finalizedDay = day as PlanDay;
      return { success: true, message: "Day finalized successfully." };
    },
  });

  const allTools = {
    google_search: google.tools.googleSearch({}),
    ...buildTools(ctx),
    ...buildSubagents(env, ctx),
    humanInTheLoop: buildHumanInTheLoop(ctx),
    finalizeDay,
  };

  // streamText でマルチステップのツール呼び出しループを回しつつ、思考・ツール実行の
  // 進行を fullStream から逐次 onActivity へ通知する（UI のライブ表示用）。AI SDK v6 は
  // stopWhen 省略時 stepCountIs(1) で 1 ステップ停止しツール結果が再投入されないため、
  // ステップ数上限・使用量上限・HITL の各停止条件を明示する。
  const result = streamText({
    model: createLlm(env, SUPERVISOR_MODEL_ID),
    system: DAY_PLANNER_SYSTEM,
    prompt: dayPlannerPrompt(plan, n, ctx),
    providerOptions: {
      google: {
        thinkingConfig: {
          // Supervisor（統括の day-planner）は gemini-3.6-flash を high で動かす。
          thinkingLevel: "high",
          includeThoughts: true,
        },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    tools: allTools,
    stopWhen: [
      stepCountIs(MAX_STEPS),
      () => shouldStopUsageLimit(ctx.usage),
      () => ctx.hitl.pending.length > 0,
    ],
  });

  // fullStream を消費してツールを実行させつつ、実行状況・思考要約を通知する。
  // 併せて、構造化の根拠となる「ツール結果(output)」と「最終テキスト」を蓄積する。
  // day planner が finalizeDay に到達せずステップ上限で打ち切られても、ここで集めた
  // 実データ（実在スポット/飲食店/移動）から確実に当日 items を組み立てられるようにする。
  // 思考(reasoning)は毎デルタ送ると setState が氾濫するため、約40文字たまるごとに末尾を送る。
  let reasoningBuf = "";
  let emittedLen = 0;
  let reasoningSeq = 0;
  let reasoningId: string | null = null;
  let finalText = "";
  const toolNotes: string[] = [];

  // 進行中の思考ブロックを「終わった思考」として履歴へ確定する。reasoning の全文を
  // detail に載せ（上限で切り詰め）、フロントで開いて読めるようにする。思考が空なら何もしない。
  const flushThinking = () => {
    if (reasoningId && reasoningBuf.trim()) {
      onEvent?.({
        kind: "thinking",
        label: "思考しました",
        status: "done",
        groupId: reasoningId,
        detail: reasoningBuf.trim().slice(0, MAX_THOUGHT_DETAIL),
      });
    }
    reasoningId = null;
    reasoningBuf = "";
    emittedLen = 0;
  };

  for await (const part of result.fullStream) {
    if (part.type === "tool-input-start") {
      // 思考の直後にツールへ移ることが多いので、まず進行中の思考を確定する。
      flushThinking();
      const label = toolLabel(part.toolName);
      onActivity?.(label);
      // ツール／サブエージェントの「開始」を履歴へ。groupId はツール呼び出しIDで done と対にする。
      onEvent?.({
        kind: SUBAGENT_NAMES.has(part.toolName) ? "subagent" : "tool",
        label,
        status: "start",
        groupId: "id" in part ? part.id : null,
      });
    } else if (part.type === "tool-result") {
      // finalizeDay の戻り値は構造化の根拠にならないので記録しない。
      if (part.toolName !== "finalizeDay") {
        const view = compactJson(part.output);
        if (view) toolNotes.push(`[${part.toolName}] ${view}`);
      }
      // ツール／サブエージェントの「完了」を履歴へ。detail はサブエージェントの要約だけ載せる
      // （通常ツールの生 JSON/HTML はノイズになるため出さない）。
      const isSubagent = SUBAGENT_NAMES.has(part.toolName);
      onEvent?.({
        kind: isSubagent ? "subagent" : "tool",
        label: toolLabel(part.toolName),
        status: "done",
        groupId: "toolCallId" in part ? part.toolCallId : null,
        detail: isSubagent ? compactJson(part.output, 200) : null,
      });
    } else if (part.type === "reasoning-start") {
      // 前の思考ブロックが未確定なら閉じてから、新しい思考の「開始」を履歴へ積む。
      flushThinking();
      reasoningSeq += 1;
      reasoningId = `think-${reasoningSeq}`;
      onActivity?.("思考しています…");
      onEvent?.({
        kind: "thinking",
        label: "思考しています",
        status: "start",
        groupId: reasoningId,
      });
    } else if (part.type === "reasoning-delta") {
      reasoningBuf += part.text;
      if (reasoningBuf.length - emittedLen >= 40) {
        emittedLen = reasoningBuf.length;
        // 生成中の思考を、同 groupId の行へ逐次反映する（履歴上でライブに見える）。
        // 末尾だけ（reasoningTail）を detail に載せ、確定時に全文へ差し替える。
        onEvent?.({
          kind: "thinking",
          label: "思考しています",
          status: "start",
          groupId: reasoningId,
          detail: reasoningTail(reasoningBuf),
        });
      }
    } else if (part.type === "reasoning-end") {
      flushThinking();
    } else if (part.type === "text-delta") {
      // 最終テキストへ移る前に進行中の思考を確定する。
      flushThinking();
      finalText += part.text;
      onActivity?.("日程をまとめています…");
    }
  }
  // ループ終了時に未確定の思考が残っていれば確定する。
  flushThinking();

  // HITL が発火していたら、day を確定せずに中断を返す。空の日をマージしないため
  // finalizeDay/構造化より先に判定する。
  if (ctx.hitl.pending.length > 0) {
    return { status: "hitl", questions: ctx.hitl.pending };
  }

  // 速い経路: finalizeDay が「中身のある日」で呼ばれていれば、それを採用する。
  // dayNumber は要求された n に固定（モデルが別番号を入れると mergeDay が誤った日を上書きする）。
  // finalizedDay はクロージャ内でのみ代入されるため TS は初期値 null から型を広げられない。
  // キャストで宣言型に戻してから items の有無で絞り込む。
  const finalized = finalizedDay as PlanDay | null;
  let day: PlanDay;
  if (finalized && finalized.items.length > 0) {
    day = sanitizeDay({ ...finalized, dayNumber: n });
  } else {
    // 構造化: finalizeDay 未到達／空でも、ストリーム中に集めたツール結果・最終テキストと
    // 目的地コンテキストを根拠に当日の itinerary を必ず組み立てる。ツールデータが乏しくても
    // モデルの知識で実在の有名スポット/飲食店を補い、items を空にしない。
    onActivity?.("日程をまとめています…", "");
    const structured = await structureDay(env, ctx, plan, n, finalText, toolNotes);
    if (structured && structured.items.length > 0) {
      day = structured;
    } else if (finalized) {
      // 最終フォールバック: 構造化できなくても finalizeDay があればそれを採用する。
      day = sanitizeDay({ ...finalized, dayNumber: n });
    } else {
      // 決定的な最小日（空 items）を返す（呼び出し側 checker/fix が後段で補う）。
      day = structured ?? { dayNumber: n, title: `${n}日目`, items: [] };
    }
  }

  // 各アイテムへ内容一致の風景画像を決定的に生成・埋め込む（各日2枚以上, #18）。
  // 全経路（finalizeDay 採用・構造化・フォールバック）に共通で適用する単一の出口。
  return { status: "ok", day: await generateDayImages(env, plan, day, onActivity) };
}

/** ツール結果を抽出根拠用にコンパクト化する（巨大 JSON を上限内に収める）。 */
function compactJson(value: unknown, max = 1500): string | null {
  try {
    const s = JSON.stringify(value);
    if (!s || s === "{}" || s === "[]" || s === "null") return null;
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return null;
  }
}

/**
 * ストリームで集めた根拠（最終テキスト + ツール結果）と目的地コンテキストから当日の
 * PlanDay を構造化する。finalizeDay 頼みをやめ、ステップ上限で打ち切られても確実に
 * items を生成できる経路。ツールデータが乏しい場合でもモデルの知識で実在の有名スポット/
 * 飲食店を補い、items を空にしない。temperature 0 / 思考最小 / 出力上限で退行を抑止する。
 * 失敗時は null。
 */
async function structureDay(
  env: Bindings,
  ctx: ToolContext,
  plan: TravelPlanDraft,
  n: number,
  plannerText: string,
  toolNotes: string[],
): Promise<PlanDay | null> {
  const dataBlock =
    toolNotes.length > 0 ? toolNotes.join("\n\n") : "(ツールデータは収集できませんでした)";
  // 目的地の手がかり（タイトル/概要/条件/座標）。タイトルは "${目的地}の旅" 形式で目的地名を含む。
  const contextBlock = [
    `旅行タイトル: ${plan.title ?? "（不明）"}`,
    `概要: ${plan.summary ?? "（なし）"}`,
    `目的地の座標: ${ctx.destPoint ? `${ctx.destPoint.lat}, ${ctx.destPoint.lng}` : "（不明）"}`,
    `条件: ${JSON.stringify(ctx.conditions)}`,
  ].join("\n");
  // 前日までの確定日程（重複回避・動線連続・予算整合のための日跨ぎコンテキスト）。
  const priorBlock = priorDaysSummary(plan, n);

  try {
    const { object } = await generateObject({
      // 最終構造化は品質重視で Supervisor モデル。退行防止のため思考は low 固定。
      model: createLlm(env, SUPERVISOR_MODEL_ID),
      // フラットな生成スキーマで anyOf を回避し、items が空のまま返るのを防ぐ。
      schema: PlanDayGenSchema,
      temperature: 0,
      maxOutputTokens: STRUCTURE_MAX_OUTPUT_TOKENS,
      // 出力が1日分と小さく安価なので、JSON 破綻時に取り直せるよう試行を1回多めに取る。
      // ここで空日を防げれば finalize 段の fillEmptyDays に頼らずに済む。
      maxRetries: 2,
      providerOptions: {
        google: {
          thinkingConfig: { thinkingLevel: "low", includeThoughts: false },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
      system:
        "あなたは1日分の旅行旅程を構造化 PlanDay として組み立てる専門家です。妥当な startTime を付けた4〜7件の、現実的で順序立てた予定（観光スポット・食事・移動など）を必ず作成してください。優先順位は次の通りです: (1) ツールデータにある実在の名称・住所を最優先で使う。(2) ツールデータが不足している場合は、目的地に実在するよく知られた観光スポット・飲食店・名所をあなたの知識から補う。架空の場所を作ってはいけませんが、items を空にすることは絶対に禁止です——必ず具体的な予定で埋めてください。前日までに訪問済みのスポット・飲食店は再訪・重複させず、前日の最終地点・宿泊地から自然につながる動線にし、旅行全体の予算を意識すること。スキーマや検証に関するメタ的な文言をどのフィールドにも書かないこと。出力（title・description・各 item の名称など、すべての自然言語フィールド）は必ず日本語で記述してください。`title` は『N日目』のような短いラベルにしてください。",
      prompt: `対象は ${n}日目です。\n\n旅行のコンテキスト:\n${contextBlock}\n\nこれまでに確定した日程（重複させない／動線をつなぐ）:\n${priorBlock}\n\nプランナーのメモ:\n${plannerText || "(なし)"}\n\nツールで収集したデータ:\n${dataBlock}`,
    });
    // 生成スキーマ（フラット）→ 保存スキーマ（union）。type により union のいずれかを
    // 満たすため実体は互換。型上は別物なので PlanDay へキャストする。
    return sanitizeDay({ ...object, dayNumber: n } as PlanDay);
  } catch {
    return null;
  }
}
