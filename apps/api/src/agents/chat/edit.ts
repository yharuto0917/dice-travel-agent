import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import {
  type PendingPlanEdit,
  type PlanDay,
  PlanDayGenSchema,
  type PlanItem,
  PlanItemGenSchema,
  type TravelPlan,
  type TravelPlanDraft,
} from "@repo/shared";
import { generateObject, generateText, stepCountIs, streamText } from "ai";
import { z } from "zod";
import type { Bindings } from "../../env";
import { shouldStopUsageLimit } from "../flow/judgement";
import { mergeDay } from "../flow/merge";
import { imageSubject, selectImageTargets } from "../flow/orchestrator";
import { createLlm, SUBAGENT_MODEL_ID, SUPERVISOR_MODEL_ID } from "../llm/provider";
import { buildTools } from "../tools";
import type { GeneratedImage, ToolContext } from "../tools/context";
import { generateItemImage } from "../tools/generate-image";
import { checkPlan } from "../validation/checker";
import { diffPlans } from "../validation/diff";
import { fixPlan } from "../validation/fix";
import { toolActivityLabel } from "./answer";
import {
  EDIT_RESEARCH_SYSTEM,
  EDIT_SYSTEM,
  editDayPrompt,
  editResearchPrompt,
  editSummaryPrompt,
} from "./prompts";

/** 1日分の再生成の出力上限。4〜7件の itinerary を収めつつ退行を短時間で打ち切る。 */
const EDIT_DAY_MAX_OUTPUT_TOKENS = 4096;

/** 修正案の説明文の出力上限（1文の見出しのみ）。 */
const EDIT_SUMMARY_MAX_OUTPUT_TOKENS = 128;

/**
 * 検証失敗時の修復試行回数。会話の応答性を優先し、計画生成の finalize（2回）より短くする。
 * ここで直らない提案は出さず、利用者に指示を出し直してもらう。
 */
const EDIT_FIX_ATTEMPTS = 1;

/**
 * 1回の修正で**新しく生成する**画像の上限。
 *
 * 計画生成（`flow/orchestrator.ts` の `MAX_IMAGES_PER_DAY` = 6枚/日）と違い、修正は
 * チャットの応答待ち時間に直結する。画像1枚あたり「英語プロンプト生成 + 画像生成」の
 * 2回のモデル呼び出しがかかるため、待ち時間とコストの上限としてここで絞る。
 * 据え置かれた予定の画像は {@link carryOverImages} が引き継ぐので、この枠は消費しない。
 */
const MAX_EDIT_IMAGES = 2;

/**
 * 1日分の生成をやり直す順序（#20）。
 *
 * `generateObject` はスキーマ検証の失敗（`NoObjectGeneratedError`）を SDK 側で再試行しない。
 * さらに temperature 0 のままでは出力が決定的なので、同じ条件で再試行しても**同じ失敗を
 * 繰り返す**だけになる。そこで温度とモデルを変えながら作り直す。
 *
 * 失敗モードは「startTime などに指示文が混ざり検証に落ちる」degeneration。実測では
 * Supervisor モデルより軽量モデルの方がこの degeneration を起こしにくかったため、
 * 品質重視で Supervisor から始め、駄目なら軽量モデルへ落とす。
 */
const EDIT_DAY_ATTEMPTS = [
  { modelId: SUPERVISOR_MODEL_ID, temperature: 0 },
  { modelId: SUPERVISOR_MODEL_ID, temperature: 0.3 },
  { modelId: SUBAGENT_MODEL_ID, temperature: 0 },
  { modelId: SUBAGENT_MODEL_ID, temperature: 0.3 },
] as const;

/**
 * リサーチ相（#20）が回せるステップ数の上限。
 * 「検索 → 結果を見て追加検索 → まとめ」で足りるので、QAループ（5）より短く取る。
 * 対象日ごとに回るため、複数日の修正でも合計が伸びすぎないようにする。
 */
const EDIT_RESEARCH_MAX_STEPS = 3;

/** リサーチ相のまとめの出力上限。候補の箇条書きが収まれば十分。 */
const EDIT_RESEARCH_MAX_OUTPUT_TOKENS = 1024;

/** 後段のプロンプトへ載せる調査メモの最大長。文脈を食い潰さないよう切り詰める。 */
const MAX_RESEARCH_NOTES_LEN = 3000;

/** 調査メモ1件（ツール1回分の結果）の最大長。 */
const MAX_RESEARCH_ENTRY_LEN = 600;

/**
 * 思考をまとめて送る間隔（文字数）。
 * 1デルタごとに送ると WebSocket が細かいメッセージで溢れるので、ある程度たまってから流す。
 */
const REASONING_FLUSH_CHARS = 80;

/** UI へ流す思考の最大長。長考しても transient data が肥大しないよう頭打ちにする。 */
const MAX_REASONING_LEN = 4000;

/** 修正案生成の入力。 */
export interface CreatePlanEditParams {
  plan: TravelPlan;
  /** 利用者の修正指示（原文）。 */
  instruction: string;
  /** 修正対象の日番号。意図判定が返した値をそのまま渡す。 */
  dayNumbers: number[];
  /** ツール実行の進行を UI へ通知する。 */
  onActivity?: (label: string) => void;
  /** 思考過程を UI へ通知する。呼ばれるたびに**その時点までの全文**が渡る。 */
  onReasoning?: (text: string) => void;
}

/** 修正案生成の結果。検証を通らなかった場合は提案を作らない。 */
export type EditResult =
  | { status: "ok"; edit: PendingPlanEdit }
  | { status: "failed"; reason: "no_target" | "generation_failed" | "invalid_plan" };

/**
 * 修正対象の日を決める純関数。
 *
 * 意図判定が対象日を特定できなかった（dayNumbers が空）場合、全日を作り直すと
 * 出力が上限を超えて JSON が破綻するうえ、指示と無関係な日まで変わってしまう。
 * その場合は「予定のある全日」ではなく空を返し、呼び出し側で対象日の指定を促す。
 */
export function resolveTargetDays(plan: TravelPlan, dayNumbers: number[]): number[] {
  const existing = new Set(plan.days.map((d) => d.dayNumber));
  return dayNumbers.filter((n) => existing.has(n));
}

/**
 * 検証済みの修正案から `PendingPlanEdit` を組み立てる純関数。
 *
 * `proposedPlan` は完成スキーマ（`TravelPlan`）で受け取る。承認時にそのまま D1 の
 * 現行計画を置き換えるため、ここに未検証の下書きが混ざると壊れた計画が保存される。
 */
export function buildPendingEdit(
  current: TravelPlan,
  proposed: TravelPlan,
  summary: string,
  now: Date = new Date(),
): PendingPlanEdit {
  return {
    id: crypto.randomUUID(),
    summary,
    proposedPlan: proposed,
    diff: diffPlans(current, proposed),
    createdAt: now.toISOString(),
  };
}

/**
 * 見出し用サマリを整える純関数。
 *
 * モデルは指示に無くても「（24文字）」のような注記や引用符を付けてくることがある。
 * 見出しとして表示するので、そうした付随物だけ落として1行に収める。
 */
export function cleanSummary(text: string): string {
  return (
    text
      .replace(/[（(]\s*\d+\s*文字\s*[)）]/g, "")
      .replace(/^["'「『]|["'」』]$/g, "")
      .split("\n")[0]
      ?.trim() ?? ""
  );
}

/** 修正内容の1文サマリを作る。失敗しても提案自体は成立させたいのでフォールバックを返す。 */
async function summarizeEdit(
  env: Bindings,
  instruction: string,
  dayNumbers: number[],
): Promise<string> {
  const fallback = `${dayNumbers.map((n) => `${n}日目`).join("・")}の予定を変更しました`;
  try {
    const { text } = await generateText({
      model: createLlm(env, SUBAGENT_MODEL_ID),
      temperature: 0,
      maxOutputTokens: EDIT_SUMMARY_MAX_OUTPUT_TOKENS,
      maxRetries: 1,
      providerOptions: {
        google: {
          thinkingConfig: { thinkingLevel: "medium", includeThoughts: true },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
      prompt: editSummaryPrompt(instruction, dayNumbers),
    });
    return cleanSummary(text) || fallback;
  } catch {
    return fallback;
  }
}

/** タイトル・説明の最大長。退行で混入した巨大文字列を切り詰める。 */
const MAX_TITLE_LEN = 120;
const MAX_DESC_LEN = 800;

/**
 * 1日に最低限必要な予定の件数（#20）。
 *
 * degeneration を起こしたモデルは「1件だけ書いて力尽きる」形の出力を返す。
 * `PlanDayGenSchema` の `min(1)` のままだとこれが検証を通ってしまい、
 * 6件あった日が1件に潰れた計画が「成功」として保存される（見えない品質劣化）。
 * プロンプトは4〜7件を求めているので、余裕を持たせた下限で弾いて再試行させる。
 */
const MIN_ITEMS_PER_DAY = 3;

/**
 * 編集ループ専用の生成スキーマ（#20）。
 *
 * - `startTime`: 書式検証を外す。Gemini は「08:30 …（指示文の続き）」のような prose を
 *   混ぜる degeneration を高頻度で起こし、`"HH:mm"` の regex を課すとこの1フィールドの
 *   ために1日分の生成が丸ごと捨てられる。緩く受けて {@link normalizeStartTime} で救い出す。
 * - `items`: 逆に件数の下限は**厳しく**する。緩めたままだと degeneration の出力が
 *   そのまま通り、日程が潰れたまま保存されてしまうため。
 */
const EditDayGenSchema = PlanDayGenSchema.extend({
  items: z
    .array(PlanItemGenSchema.extend({ startTime: z.string().optional() }))
    .min(MIN_ITEMS_PER_DAY),
});

/**
 * モデルが返した startTime から `"HH:mm"` を取り出す純関数。
 *
 * 先頭に時刻があり後ろに説明文が続く形が典型なので、最初に現れる時刻を採用する。
 * 時刻が見つからなければ「時刻なし」として捨てる（誤った時刻を作らない）。
 */
export function normalizeStartTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const matched = value.match(/([01]?\d|2[0-3]):([0-5]\d)/);
  if (!matched) return undefined;
  return `${matched[1]?.padStart(2, "0")}:${matched[2]}`;
}

/** 文字列を安全長へ切り詰める。 */
function clampText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  // 空白だけの値は「無い」と同じ扱いにする（`flow/orchestrator.ts` の clampText と同じ理由）。
  if (trimmed === "") return undefined;
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

/**
 * 生成された1日分を保存スキーマへ寄せる（#20）。
 *
 * startTime の救出に加え、退行で膨らんだ title/description を切り詰める。
 * `flow/orchestrator.ts` の `sanitizeDay` と同じ役割を、チャットの編集経路にも置く。
 *
 * `image` はモデルの出力を一切採用せず必ず捨てる。画像 URL はランダム UUID を含む
 * R2 の配信 URL で、モデルには正確に転記できず（存在しない URL を作る／別アイテムの
 * URL を貼る）、しおりに壊れた画像が出る。既存画像の引き継ぎは {@link carryOverImages}、
 * 新規生成は {@link generateEditImages} がコード側で決定的に行う。
 */
export function sanitizeGeneratedDay(
  day: z.infer<typeof EditDayGenSchema>,
  dayNumber: number,
): PlanDay {
  return {
    ...day,
    dayNumber,
    items: day.items.map(({ image: _image, ...item }) => ({
      ...item,
      title: clampText(item.title, MAX_TITLE_LEN) ?? item.title,
      description: clampText(item.description, MAX_DESC_LEN),
      startTime: normalizeStartTime(item.startTime),
    })),
  } as PlanDay;
}

/**
 * 同じ予定の繰り返しで水増しされた日を弾く（degeneration 検出, 純関数）。
 *
 * 実測で「同じスポットを3件並べて終わる」出力が観測された。件数だけ見る
 * {@link MIN_ITEMS_PER_DAY} は通ってしまい、1日が同じ予定だけに潰れた計画が
 * 「成功」として提案される。重複を除いた実質の件数で下限を見て、次の試行へ回す。
 */
export function isDegenerateDay(day: PlanDay): boolean {
  const distinct = new Set(day.items.map((item) => item.title.replace(/\s+/g, "").toLowerCase()));
  return distinct.size < MIN_ITEMS_PER_DAY;
}

/**
 * 画像を引き継ぐときの同一性キー。タイトルと場所名の両方を鍵にする。
 *
 * 修正では「昼食だけ差し替え」のように大半の予定が残るが、その場合でもモデルは
 * 表記を微妙に変える（全角空白・前後の空白など）。表記ゆれで引き継ぎに失敗すると
 * 無関係な再生成が走るため、空白を潰して比較する。
 */
function imageCarryKeys(item: PlanItem): string[] {
  const normalize = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  const keys = [normalize(item.title)];
  const place = item.location?.name?.trim();
  if (place) keys.push(normalize(place));
  return keys;
}

/**
 * 修正前の同じ日から、据え置かれた予定の画像を引き継ぐ（純関数）。
 *
 * 編集経路は対象日を**丸ごと作り直す**ため、何もしないと指示に関係のない予定からも
 * 画像が消える（修正するたびにしおりの写真が減っていく）。ここで元の日と突き合わせ、
 * 同じ場所を指す予定には元の画像をそのまま戻す。これにより新規生成の枠
 * （{@link MAX_EDIT_IMAGES}）は「本当に増えた予定」だけに使われる。
 */
export function carryOverImages(previous: PlanDay | undefined, day: PlanDay): PlanDay {
  if (!previous) return day;

  // タイトル・場所名の**どちらか**が一致すれば同じ場所とみなす。片方だけ持つ書き方
  // （「首里城の見学」/ location=「首里城公園」）に修正の前後で揺れるため、両方を鍵にする。
  const byKey = new Map<string, PlanItem["image"]>();
  for (const item of previous.items) {
    if (!item.image) continue;
    for (const key of imageCarryKeys(item)) {
      if (!byKey.has(key)) byKey.set(key, item.image);
    }
  }
  if (byKey.size === 0) return day;

  return {
    ...day,
    items: day.items.map((item) => {
      if (item.image) return item;
      const image = imageCarryKeys(item)
        .map((key) => byKey.get(key))
        .find((found) => found !== undefined);
      return image ? { ...item, image } : item;
    }),
  };
}

/**
 * ツール結果とまとめを、後段プロンプトへ載せる調査メモへ整形する純関数（#20）。
 *
 * ツールの生 JSON は長大なので、1件ずつ・全体の双方で長さを抑える。まとめ（モデルの文章）は
 * 候補の要点そのものなので先頭に置き、根拠となる生データを後ろに並べる。
 */
export function buildResearchNotes(
  summary: string,
  toolOutputs: { toolName: string; output: unknown }[],
): string | null {
  const lines: string[] = [];
  const trimmedSummary = summary.trim();
  if (trimmedSummary) lines.push(trimmedSummary);

  for (const { toolName, output } of toolOutputs) {
    const view = compactJson(output, MAX_RESEARCH_ENTRY_LEN);
    if (view) lines.push(`[${toolName}] ${view}`);
  }

  const notes = lines.join("\n");
  if (!notes.trim()) return null;
  return notes.length > MAX_RESEARCH_NOTES_LEN
    ? `${notes.slice(0, MAX_RESEARCH_NOTES_LEN)}…`
    : notes;
}

/** ツール結果を1行の JSON へ潰す。中身が空なら null（メモに載せない）。 */
function compactJson(value: unknown, max: number): string | null {
  try {
    const s = JSON.stringify(value);
    if (!s || s === "{}" || s === "[]" || s === "null") return null;
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return null;
  }
}

/** 修正案づくりの思考を UI へ流す係。 */
export interface ReasoningReporter {
  /** 思考の見出し（「2日目の下調べ」など）を1行差し込む。 */
  section: (title: string) => void;
  /** 思考の続きを書き足す。しきい値までたまったら自動で流す。 */
  append: (delta: string) => void;
  /** たまっている分を今すぐ流す。 */
  flush: () => void;
}

/**
 * 思考の断片を組み立てて UI へ流す係を作る（#20）。
 *
 * 修正案づくりは下調べ（ストリーム）と構造化（一括）で思考の出方が違うため、
 * 双方を1本の流れへ束ねてから送る。上限に達した分は捨てる（先頭を残す）——
 * 思考は読み物であって記録ではないので、頭が欠けるより尻が切れる方が読める。
 */
export function createReasoningReporter(onReasoning?: (text: string) => void): ReasoningReporter {
  let text = "";
  let emitted = 0;

  const flush = () => {
    if (!onReasoning || text.length === emitted) return;
    emitted = text.length;
    onReasoning(text);
  };

  const write = (chunk: string) => {
    if (!onReasoning || text.length >= MAX_REASONING_LEN) return;
    text += chunk;
    if (text.length > MAX_REASONING_LEN) text = `${text.slice(0, MAX_REASONING_LEN)}…`;
  };

  return {
    section: (title) => {
      write(`${text ? "\n\n" : ""}**${title}**\n`);
      flush();
    },
    append: (delta) => {
      write(delta);
      if (text.length - emitted >= REASONING_FLUSH_CHARS) flush();
    },
    flush,
  };
}

/**
 * 対象1日分の下調べをツールで行う（リサーチ相, #20）。
 *
 * 構造化生成（`generateObject`）はツールを呼べない。ツール定義を渡す口が無く、
 * モデルの記憶だけで「実在する場所」を書かせることになるため、閉店済みの店や
 * 存在しない施設が旅程へ混ざる。そこで生成をリサーチ相と構造化相に分け、
 * ここで集めた実在情報を後段のプロンプトへ材料として渡す。
 *
 * 下調べは**あくまで補助**なので、失敗しても例外を投げず null を返す。
 * ツールや検索APIが落ちていても、従来どおり構造化相だけで提案は作れる。
 */
async function researchDay(
  env: Bindings,
  ctx: ToolContext,
  plan: TravelPlan,
  dayNumber: number,
  instruction: string,
  reasoning: ReasoningReporter,
  onActivity?: (label: string) => void,
): Promise<string | null> {
  try {
    const result = streamText({
      model: createLlm(env, SUBAGENT_MODEL_ID),
      system: EDIT_RESEARCH_SYSTEM,
      prompt: editResearchPrompt(plan, dayNumber, instruction),
      tools: buildTools(ctx),
      // 複数日の修正では日ごとに呼ばれるので、ステップ上限に加えて計画全体で共有する
      // 使用量カウンタでも止める（ctx.usage は対象日をまたいで累積する）。
      stopWhen: [stepCountIs(EDIT_RESEARCH_MAX_STEPS), () => shouldStopUsageLimit(ctx.usage)],
      maxOutputTokens: EDIT_RESEARCH_MAX_OUTPUT_TOKENS,
      providerOptions: {
        google: {
          // 下調べは候補集めなので思考の深さは控えめ。ただし思考テキストは受け取り、
          // 待ち時間の長い下調べ中に「何を考えているか」を UI へ流す。
          thinkingConfig: { thinkingLevel: "low", includeThoughts: true },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
    });

    // fullStream を消費してツールを実行させつつ、進行と思考を UI へ通知し、結果を材料として集める。
    const toolOutputs: { toolName: string; output: unknown }[] = [];
    for await (const part of result.fullStream) {
      if (part.type === "tool-input-start") {
        onActivity?.(toolActivityLabel(part.toolName));
      } else if (part.type === "tool-result") {
        toolOutputs.push({ toolName: part.toolName, output: part.output });
      } else if (part.type === "reasoning-delta") {
        reasoning.append(part.text);
      }
    }
    reasoning.flush();

    return buildResearchNotes(await result.text, toolOutputs);
  } catch {
    return null;
  }
}

/**
 * 対象1日分を生成する。スキーマ検証に落ちたら温度を上げて作り直す（#20）。
 *
 * `generateObject` は検証失敗を再試行しないため、ここで自分で回す。
 * 全試行が失敗したら null を返し、呼び出し側は提案を作らない。
 *
 * `notes` は {@link researchDay} が集めた実在候補。試行ごとに調べ直すと同じ検索を
 * 何度も叩くので、下調べは呼び出し側で1回だけ行い、その結果を全試行で使い回す。
 *
 * 思考は `generateObject` が一括で返すため、下調べのようにストリームでは流せない。
 * 成功した試行の分だけを終わったあとに流す（失敗した試行の思考は混ぜない）。
 */
async function generateDay(
  env: Bindings,
  plan: TravelPlan,
  draft: TravelPlanDraft,
  dayNumber: number,
  instruction: string,
  notes: string | null,
  reasoning: ReasoningReporter,
): Promise<PlanDay | null> {
  for (const { modelId, temperature } of EDIT_DAY_ATTEMPTS) {
    try {
      const { object, reasoning: thought } = await generateObject({
        model: createLlm(env, modelId),
        schema: EditDayGenSchema,
        temperature,
        maxOutputTokens: EDIT_DAY_MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        providerOptions: {
          google: {
            thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
          } satisfies GoogleGenerativeAIProviderOptions,
        },
        system: EDIT_SYSTEM,
        // 直前までの修正を反映した状態を毎回渡す（同一ターン内で日をまたぐ整合を取る）。
        prompt: editDayPrompt({ ...plan, ...draft } as TravelPlan, dayNumber, instruction, notes),
      });

      if (thought) {
        reasoning.section(`${dayNumber}日目の組み立て`);
        reasoning.append(thought);
        reasoning.flush();
      }
      const generated = sanitizeGeneratedDay(object, dayNumber);
      // 同じ予定の繰り返しで水増しされた日は採用せず、次の条件で作り直す。
      if (isDegenerateDay(generated)) continue;
      return generated;
    } catch {
      // 次の温度で作り直す。全滅した場合だけ諦める。
    }
  }
  return null;
}

/**
 * 修正で新しく増えた観光スポットへ風景画像を生成・添付する（#18 の生成経路と同じ方式）。
 *
 * 計画生成では1日あたり最大6枚まで作るが、チャットの修正は会話の待ち時間に直結するため
 * **修正1回あたり {@link MAX_EDIT_IMAGES} 枚**に絞る。枠は対象日の若い順に配り、
 * 使い切ったらそれ以降の日は画像なしのままにする（次の修正でまた枠が復活する）。
 *
 * 画像生成の失敗は提案そのものを壊さない。1枚失敗しても他の枚数と修正案は生かす。
 */
async function generateEditImages(
  env: Bindings,
  plan: TravelPlan,
  draft: TravelPlanDraft,
  dayNumbers: number[],
  onActivity?: (label: string) => void,
): Promise<TravelPlanDraft> {
  const days = draft.days ?? [];

  // 対象日を順に見て、画像の無い観光スポットを枠が尽きるまで拾う。
  const picks: { dayNumber: number; index: number; item: PlanItem }[] = [];
  for (const dayNumber of dayNumbers) {
    const remaining = MAX_EDIT_IMAGES - picks.length;
    if (remaining <= 0) break;
    const day = days.find((d) => d.dayNumber === dayNumber);
    if (!day) continue;
    for (const target of selectImageTargets(day.items, remaining)) {
      picks.push({ dayNumber, index: target.index, item: target.item });
    }
  }
  if (picks.length === 0) return draft;

  onActivity?.("風景画像を生成しています…");
  // setup ステップで title は "${目的地}の旅" 形式。末尾の "の旅" を落として目的地名を得る。
  const destinationName = plan.title?.replace(/の旅$/, "").trim() || null;

  const generated = await Promise.all(
    picks.map((pick) =>
      generateItemImage(env, imageSubject(pick.item, destinationName)).catch(() => null),
    ),
  );

  // 「何日目の何番目」→ 生成画像。1枚も作れなかったら計画には触らない。
  const byPosition = new Map<string, GeneratedImage>();
  picks.forEach((pick, k) => {
    const image = generated[k];
    if (image) byPosition.set(`${pick.dayNumber}:${pick.index}`, image);
  });
  if (byPosition.size === 0) return draft;

  return {
    ...draft,
    days: days.map((day) => ({
      ...day,
      items: day.items.map((item, index) => {
        const image = byPosition.get(`${day.dayNumber}:${index}`);
        return image
          ? { ...item, image: { url: image.url, alt: image.prompt, generated: true } }
          : item;
      }),
    })),
  };
}

/**
 * チャットの修正指示から計画の修正案を作る（編集ループ, #20）。
 *
 * 対象の日だけを再生成して現行計画へ合成する。全計画を一度に作り直すと、複数日分の
 * JSON が出力上限を超えて切り詰められ修復不能になるため（`validation/fix.ts` と同じ理由）、
 * 生成は必ず 1 日単位に閉じる。
 *
 * 1日ごとに「下調べ（ツール）→ 構造化生成」の2相で作る。`generateObject` はツールを
 * 呼べないため、実在情報の収集は {@link researchDay} に前倒しし、その結果をプロンプトの
 * 材料として渡す。
 *
 * 生成 → `mergeDay` → `checkPlan` → 必要なら `fixPlan` の順に通し、**検証を通った
 * 完成計画だけ**を提案にする。修復しても通らないものは提案を作らない（承認ボタンを
 * 押した瞬間に壊れた計画が保存されるのを防ぐ）。
 */
export async function createPlanEdit(
  env: Bindings,
  ctx: ToolContext,
  params: CreatePlanEditParams,
): Promise<EditResult> {
  const { plan, instruction, dayNumbers, onActivity, onReasoning } = params;
  const targets = resolveTargetDays(plan, dayNumbers);
  if (targets.length === 0) return { status: "failed", reason: "no_target" };

  // 思考は対象日をまたいで1本の流れとして見せる（日ごとに見出しで区切る）。
  const reasoning = createReasoningReporter(onReasoning);

  // 対象日は前の日の結果を踏まえて順に作る（動線・重複の整合を保つため並列にしない）。
  let draft: TravelPlanDraft = plan;
  for (const dayNumber of targets) {
    reasoning.section(`${dayNumber}日目の下調べ`);
    // 下調べは日ごとに1回だけ。生成の再試行では同じメモを使い回す（検索の重複を避ける）。
    const notes = await researchDay(
      env,
      ctx,
      { ...plan, ...draft } as TravelPlan,
      dayNumber,
      instruction,
      reasoning,
      onActivity,
    );
    const day = await generateDay(env, plan, draft, dayNumber, instruction, notes, reasoning);
    if (!day) return { status: "failed", reason: "generation_failed" };
    // 据え置かれた予定の画像を戻してから合成する。新規生成の枠は、これで画像が
    // 付かなかった＝本当に増えた観光スポットだけに使う。
    const previous = draft.days?.find((d) => d.dayNumber === dayNumber);
    draft = mergeDay(draft, carryOverImages(previous, day));
  }

  // 新しく増えた観光スポットへ画像を付ける。検証（checkPlan / fixPlan）より前に置き、
  // 提案としてプレビューされる計画に画像が含まれるようにする。
  draft = await generateEditImages(env, plan, draft, targets, onActivity);

  const check = checkPlan(draft);
  let proposed: TravelPlan | null = check.valid && check.parsed ? check.parsed : null;

  if (!proposed) {
    try {
      proposed = await fixPlan(env, draft, check.errors, EDIT_FIX_ATTEMPTS);
    } catch {
      proposed = null;
    }
  }
  if (!proposed) return { status: "failed", reason: "invalid_plan" };

  const summary = await summarizeEdit(env, instruction, targets);
  return { status: "ok", edit: buildPendingEdit(plan, proposed, summary) };
}
