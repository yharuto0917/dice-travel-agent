import type {
  AgentPhase,
  BudgetBreakdown,
  Money,
  PlanDay,
  TravelPlanDraft,
  TripConditions,
} from "@repo/shared";

/**
 * TravelPlanningAgent（#13）の段階フロー定義。
 *
 * 各ステップは「決まったフロー」の1段階で、計画書ドラフト(`TravelPlanDraft`)を
 * 段階的に充填する純関数 `fill` を持つ。Agent クラスはこのパイプラインを
 * スケジュール駆動で順に実行し、結果を `setState` でクライアントへ同期する。
 *
 * 注: 本ファイルは骨格(#13)のスタブ。条件から決定的にダミーデータを生成するだけで、
 * 実際の外部API/Gemini呼び出しは #14 で各 `fill` に差し込む。
 * 純関数に保つことで DO ランタイム無しに vitest で検証できる。
 */

/** `fill` に渡す入力コンテキスト（D1 の plan 行から Agent が組み立てる）。 */
export type FillContext = {
  /** 旅行条件（未取得なら既定値で補完） */
  conditions?: TripConditions | null;
  /** 行き先の都道府県名（draft.destination は緯度経度が必要なため #14 で設定） */
  destinationName?: string | null;
  /** 仕上げ時刻(ISO)。決定論を保つため Agent から注入する */
  nowIso?: string;
};

/** パイプラインの1ステップ。 */
export type PipelineStep = {
  phase: AgentPhase;
  /** 充填済みセクション名（AgentState.filledSections に積む） */
  section: string;
  fill: (prev: TravelPlanDraft, ctx: FillContext) => TravelPlanDraft;
};

/** 概算の日本円 Money を作る小ヘルパー。 */
const jpy = (amount: number): Money => ({
  amount: Math.round(amount),
  currency: "JPY",
  approx: true,
});

/** 条件の泊数（既定1泊）。 */
const nightsOf = (ctx: FillContext): number => ctx.conditions?.nights ?? 1;

/** 行き先の表示名（未取得時のフォールバック）。 */
const destOf = (ctx: FillContext): string => ctx.destinationName?.trim() || "目的地";

/** 0..nights を「日数」(nights+1) に変換。日帰り(0泊)は1日。 */
const dayCountOf = (ctx: FillContext): number => nightsOf(ctx) + 1;

export const PLAN_PIPELINE: PipelineStep[] = [
  // 0. 行き先・条件の理解：タイトル/サマリーの骨子を置く
  {
    phase: "understanding",
    section: "conditions",
    fill: (prev, ctx) => ({
      ...prev,
      status: "draft",
      title: `${destOf(ctx)}の旅`,
      summary: `${destOf(ctx)}を巡る${nightsOf(ctx) === 0 ? "日帰り" : `${nightsOf(ctx)}泊${nightsOf(ctx) + 1}日`}のプランを作成します。`,
      nights: nightsOf(ctx),
    }),
  },

  // 1. 情報収集：骨格ではフェーズ前進のみ（実APIは #14）
  {
    phase: "collecting",
    section: "research",
    fill: (prev) => ({ ...prev }),
  },

  // 2. 日程設計：日数ぶんの days[] を生成し、各日に自由時間の枠を置く
  {
    phase: "designing",
    section: "days",
    fill: (prev, ctx) => {
      const days: PlanDay[] = Array.from({ length: dayCountOf(ctx) }, (_, i) => {
        const dayNumber = i + 1;
        return {
          dayNumber,
          title: `${dayNumber}日目`,
          items: [{ id: `d${dayNumber}-free`, type: "free" as const, title: "フリータイム" }],
        };
      });
      return { ...prev, days };
    },
  },

  // 3. 宿：宿泊する日（最終日を除く nights 日）に宿泊アイテムを追加
  {
    phase: "lodging",
    section: "lodging",
    fill: (prev, ctx) => {
      const nights = nightsOf(ctx);
      const days = (prev.days ?? []).map((day) =>
        day.dayNumber <= nights
          ? {
              ...day,
              items: [
                ...day.items,
                {
                  id: `d${day.dayNumber}-lodging`,
                  type: "lodging" as const,
                  title: "宿泊（未定）",
                  description: "宿の候補は情報収集ステップ（#14）で実データに置き換えます。",
                },
              ],
            }
          : day,
      );
      return { ...prev, days };
    },
  },

  // 4. 飲食：各日に食事アイテムを追加
  {
    phase: "food",
    section: "food",
    fill: (prev) => {
      const days = (prev.days ?? []).map((day) => ({
        ...day,
        items: [
          ...day.items,
          { id: `d${day.dayNumber}-meal`, type: "meal" as const, title: "昼食（未定）" },
        ],
      }));
      return { ...prev, days };
    },
  },

  // 5. 移動：初日に移動アイテムを追加（実ルートは #14）
  {
    phase: "transport",
    section: "transport",
    fill: (prev) => {
      const days = (prev.days ?? []).map((day) =>
        day.dayNumber === 1
          ? {
              ...day,
              items: [
                ...day.items,
                {
                  id: `d${day.dayNumber}-transport`,
                  type: "transport" as const,
                  title: "移動（未定）",
                },
              ],
            }
          : day,
      );
      return { ...prev, days };
    },
  },

  // 6. 予算：条件の予算上限から内訳を概算
  {
    phase: "budget",
    section: "budget",
    fill: (prev, ctx) => {
      const total = ctx.conditions?.budgetRange?.[1] ?? 50000;
      const budget: BudgetBreakdown = {
        lodging: jpy(total * 0.4),
        food: jpy(total * 0.25),
        transport: jpy(total * 0.25),
        activities: jpy(total * 0.1),
        total: jpy(total),
      };
      return { ...prev, budget };
    },
  },

  // 7. 仕上げ：完成扱いにしてメタ情報を確定
  {
    phase: "finalizing",
    section: "summary",
    fill: (prev, ctx) => ({
      ...prev,
      status: "completed",
      createdAt: ctx.nowIso,
    }),
  },
];
