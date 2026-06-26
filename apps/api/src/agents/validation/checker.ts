import { type TravelPlan, type TravelPlanDraft, TravelPlanSchema } from "@repo/shared";

export interface CheckResult {
  valid: boolean;
  errors: string[];
  /** 構造検証を通過した場合のみ、完成スキーマ型として返す。 */
  parsed?: TravelPlan;
}

/**
 * 計画の充足チェック（#16）。
 * 1) `TravelPlanSchema.safeParse` で必須項目・型を強制（構造検証）。
 * 2) 構造を満たした場合のみ意味的検証（日数整合・空日・予算超過）を行う。
 * エラーは日本語メッセージで返し、fix のプロンプトにそのまま渡せる。
 */
export function checkPlan(plan: TravelPlanDraft): CheckResult {
  const result = TravelPlanSchema.safeParse(plan);
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    return { valid: false, errors };
  }

  const parsed = result.data;
  const errors: string[] = [];

  // 日数整合: days.length === nights + 1
  const expectedDays = parsed.nights + 1;
  if (parsed.days.length !== expectedDays) {
    errors.push(
      `日数が一致しません（days=${parsed.days.length}, 期待=${expectedDays} / ${parsed.nights}泊）`,
    );
  }

  // 各日に予定（items）が存在するか
  for (const day of parsed.days) {
    if (day.items.length === 0) {
      errors.push(`${day.dayNumber}日目に予定（items）がありません`);
    }
  }

  // 予算超過: 計画総額 > 条件の上限（1人あたり上限 × 人数）
  const perPersonMax = parsed.conditions.budgetRange?.[1];
  const partySize = parsed.conditions.partySize ?? 1;
  const total = parsed.budget?.total?.amount;
  if (perPersonMax != null && total != null && total > perPersonMax * partySize) {
    errors.push(
      `総予算 ${total} 円が条件の上限 ${perPersonMax * partySize} 円（${perPersonMax}円 × ${partySize}名）を超えています`,
    );
  }

  return { valid: errors.length === 0, errors, parsed };
}
