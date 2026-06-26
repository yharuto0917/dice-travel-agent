import type { DayDiff, ItemDiff, PlanDay, PlanDiff, PlanItem, TravelPlanDraft } from "@repo/shared";

/** アイテム配列を id 基準で差分。順序は新(b)の並び→旧(a)で消えた分の順で安定。 */
function diffItems(aItems: PlanItem[], bItems: PlanItem[]): ItemDiff[] {
  const aById = new Map(aItems.map((it) => [it.id, it]));
  const bIds = new Set(bItems.map((it) => it.id));
  const result: ItemDiff[] = [];

  for (const ib of bItems) {
    const ia = aById.get(ib.id);
    if (!ia) {
      result.push({ change: "added", title: ib.title });
    } else {
      const changed = JSON.stringify(ia) !== JSON.stringify(ib);
      result.push({ change: changed ? "changed" : "unchanged", title: ib.title });
    }
  }
  for (const ia of aItems) {
    if (!bIds.has(ia.id)) {
      result.push({ change: "removed", title: ia.title });
    }
  }
  return result;
}

function dayMap(days: PlanDay[] | undefined): Map<number, PlanDay> {
  return new Map((days ?? []).map((d) => [d.dayNumber, d]));
}

/**
 * 2版の計画間の構造化差分（#16 バージョニング）。
 * タイトル/要約/予算の変更フラグと、日・アイテム単位の追加/削除/変更を返す。
 * 純関数でテスト容易。a=旧版, b=新版。
 */
export function diffPlans(a: TravelPlanDraft, b: TravelPlanDraft): PlanDiff {
  const titleChanged = (a.title ?? "") !== (b.title ?? "");
  const summaryChanged = (a.summary ?? "") !== (b.summary ?? "");
  const budgetChanged = (a.budget?.total?.amount ?? null) !== (b.budget?.total?.amount ?? null);

  const aDays = dayMap(a.days);
  const bDays = dayMap(b.days);
  const dayNumbers = [...new Set([...aDays.keys(), ...bDays.keys()])].sort((x, y) => x - y);

  const days: DayDiff[] = dayNumbers.map((dn) => {
    const da = aDays.get(dn);
    const db = bDays.get(dn);
    if (da && !db) {
      return { dayNumber: dn, change: "removed", items: diffItems(da.items, []) };
    }
    if (!da && db) {
      return { dayNumber: dn, change: "added", items: diffItems([], db.items) };
    }
    // 両版に存在 → アイテム差分とタイトル変更から日単位の変更を判定
    const items = diffItems((da as PlanDay).items, (db as PlanDay).items);
    const titleDiff = ((da as PlanDay).title ?? "") !== ((db as PlanDay).title ?? "");
    const change =
      items.some((it) => it.change !== "unchanged") || titleDiff ? "changed" : "unchanged";
    return { dayNumber: dn, change, items };
  });

  return { titleChanged, summaryChanged, budgetChanged, days };
}
