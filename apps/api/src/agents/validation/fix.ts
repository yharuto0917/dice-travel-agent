import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import {
  type PlanDay,
  PlanDayGenSchema,
  type TravelPlan,
  type TravelPlanDraft,
  TravelPlanSchema,
} from "@repo/shared";
import { generateObject } from "ai";
import { z } from "zod";
import type { Bindings } from "../../env";
import { FIX_MAX_ATTEMPTS } from "../flow/judgement";
import { createLlm, SUPERVISOR_MODEL_ID } from "../llm/provider";
import { checkPlan } from "./checker";

/**
 * 修復用スキーマ。Gemini の構造化出力(response_schema)は Zod の tuple を受け付けず
 * （`conditions.budgetRange = z.tuple([...])` は `items` が配列形になり 400:
 * "Proto field is not repeating, cannot start list" になる）、
 * かつ conditions / destination は行(DB)・ジオコーディング由来の確定値で LLM が
 * 書き換えるべきではない。両者をスキーマから除外し、検証前に元の値をマージし直す。
 *
 * さらに days は anyOf を避けたフラットな {@link PlanDayGenSchema} に差し替える。
 * 既定の union(items) のままだと Gemini が items を空配列で返し「各日の旅程が出ない」ため。
 */
const PlanRepairSchema = TravelPlanSchema.omit({ conditions: true, destination: true }).extend({
  days: z.array(PlanDayGenSchema),
});

/** 修復出力の上限。退行(同語反復)が起きても短時間で打ち切るための安全弁。 */
const REPAIR_MAX_OUTPUT_TOKENS = 8192;

/** 1日分の再生成出力の上限。1日 4〜7件の itinerary を収めつつ退行を短時間で打ち切る。 */
const DAY_REPAIR_MAX_OUTPUT_TOKENS = 4096;

/**
 * items が空の日を「1日ずつ個別に」再生成する（#16 の堅牢化）。
 *
 * fixPlan は計画全体を 1 回の generateObject で作り直すため、複数日×詳細 items の
 * 全 JSON が maxOutputTokens を超えると出力が途中で打ち切られ、不完全 JSON で
 * generateObject が throw → null → 空日が残る、という形で「JSON 破綻で修復が効かない」
 * 状態に陥っていた。これに対し本関数は出力を 1 日分の PlanDay に限定するため、
 * トークン枠に確実に収まり JSON 切り詰めを起こしにくい。各日の生成は独立なので
 * 並列実行し、ある日が失敗(throw)してもその日は元のまま（空のまま）にして他日へ波及させない。
 *
 * ツールデータは持たないため、目的地コンテキストとモデルの知識で実在の有名スポット/
 * 飲食店を補い、items を空にしないことを最優先する。temperature 0 / 思考最小で退行を抑止。
 */
export async function fillEmptyDays(
  env: Bindings,
  plan: TravelPlanDraft,
): Promise<TravelPlanDraft> {
  const days = plan.days ?? [];
  if (!days.some((d) => d.items.length === 0)) return plan;

  const dest = plan.destination;
  const contextBlock = [
    `旅行タイトル: ${plan.title ?? "（不明）"}`,
    `概要: ${plan.summary ?? "（なし）"}`,
    `目的地: ${dest?.prefecture ?? "（不明）"}`,
    `目的地の座標: ${dest?.location ? `${dest.location.lat}, ${dest.location.lng}` : "（不明）"}`,
    `条件: ${JSON.stringify(plan.conditions ?? {})}`,
  ].join("\n");

  const repaired = await Promise.all(
    days.map(async (day): Promise<PlanDay> => {
      if (day.items.length > 0) return day;
      try {
        const { object } = await generateObject({
          model: createLlm(env, SUPERVISOR_MODEL_ID),
          // フラットな生成スキーマで anyOf を回避し、items が空のまま返るのを防ぐ。
          schema: PlanDayGenSchema,
          temperature: 0,
          maxOutputTokens: DAY_REPAIR_MAX_OUTPUT_TOKENS,
          // 出力が小さく安価なので、JSON 破綻時に取り直せるよう試行を 1 回多めに取る。
          maxRetries: 2,
          providerOptions: {
            google: {
              thinkingConfig: { thinkingLevel: "low", includeThoughts: false },
            } satisfies GoogleGenerativeAIProviderOptions,
          },
          system:
            "あなたは1日分の旅行旅程を構造化 PlanDay として組み立てる専門家です。妥当な startTime を付けた4〜7件の、現実的で順序立てた予定（観光スポット・食事・移動など）を必ず作成してください。目的地に実在するよく知られた観光スポット・飲食店・名所をあなたの知識から補ってください。架空の場所を作ってはいけませんが、items を空にすることは絶対に禁止です——必ず具体的な予定で埋めてください。スキーマや検証に関するメタ的な文言をどのフィールドにも書かないこと。出力（title・description・各 item の名称など、すべての自然言語フィールド）は必ず日本語で記述してください。`title` は『N日目』のような短いラベルにしてください。",
          prompt: `対象は ${day.dayNumber}日目です。この日の itinerary（items）が空なので、具体的な予定で埋めてください。\n\n旅行のコンテキスト:\n${contextBlock}`,
        });
        // 生成スキーマ（フラット）→ 保存スキーマ（union）。各 item は type により union の
        // いずれかを満たすため実体は互換。型上は別物なので PlanDay へキャストする。
        return { ...object, dayNumber: day.dayNumber } as PlanDay;
      } catch {
        // この日は再生成に失敗。元の（空の）日のままにして他日へ波及させない。
        return day;
      }
    }),
  );

  return { ...plan, days: repaired };
}

/**
 * 検証エラーのある計画を `generateObject` で修復する（#16）。
 * 最大 `attempts` 回、修復→再チェックを繰り返す。成功で完成型を返し、
 * 規定回数で構造を満たせなければ null（呼び出し側が HITL エスカレーション or
 * 決定的フォールバックへ）を返す。
 */
export async function fixPlan(
  env: Bindings,
  plan: TravelPlanDraft,
  errors: string[],
  attempts: number = FIX_MAX_ATTEMPTS,
): Promise<TravelPlan | null> {
  let current: TravelPlanDraft = plan;
  let currentErrors = errors;

  for (let i = 0; i < attempts; i++) {
    // 退行(同語反復ループ)を抑止するため temperature 0 / 出力上限 / 思考最小で決定的に修復する。
    // generateObject が退行や JSON 破綻で throw しても finalize を固めないよう、各試行を
    // try/catch で囲み、失敗時は次試行へ（最終的に null を返し呼び出し側が best-effort 保存）。
    let object: TravelPlanDraft;
    try {
      const result = await generateObject({
        // 修復も品質重視で Supervisor モデル。退行防止のため思考は low 固定。
        model: createLlm(env, SUPERVISOR_MODEL_ID),
        schema: PlanRepairSchema,
        temperature: 0,
        maxOutputTokens: REPAIR_MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        providerOptions: {
          google: {
            thinkingConfig: { thinkingLevel: "low", includeThoughts: false },
          } satisfies GoogleGenerativeAIProviderOptions,
        },
        system:
          "You repair a travel plan JSON so it satisfies the schema and the listed constraints. Keep existing valid content; only fill or correct what the errors point to. Do not invent unrealistic facts — prefer minimal, plausible values. Do not write meta commentary about schemas or validation in any field. Do not output trip conditions or destination; they are fixed and provided for context only. 自然言語フィールド（title・summary・各 item の名称や説明）は、すべて日本語で記述してください。",
        prompt: `Current plan JSON:\n${JSON.stringify(current, null, 2)}\n\nValidation errors to fix:\n${currentErrors.map((e) => `- ${e}`).join("\n")}`,
      });
      object = result.object;
    } catch {
      // この試行は失敗。これまでの最善（current）を呼び出し側へ委ねる。
      return null;
    }

    // 確定値（conditions / destination）を元の plan から復元してから検証する。
    const merged: TravelPlanDraft = {
      ...object,
      ...(plan.conditions ? { conditions: plan.conditions } : {}),
      ...(plan.destination ? { destination: plan.destination } : {}),
    };

    const check = checkPlan(merged);
    if (check.valid && check.parsed) {
      return check.parsed;
    }
    // 次の試行は今回の出力（確定値マージ済み）とその残エラーを根拠にする。
    current = merged;
    currentErrors = check.errors;
  }

  return null;
}
