import type { DestinationCandidate, TripConditions } from "@repo/shared";
import { PREFECTURES } from "./prefectures";

// モックの緯度経度（県庁所在地のざっくりとした座標）
const MOCK_LOCATIONS: Record<number, { lat: number; lng: number }> = {
  13: { lat: 35.6894, lng: 139.6917 }, // 東京
  27: { lat: 34.6863, lng: 135.52 }, // 大阪
  // 他は仮の座標
};

export interface ShuffleOptions {
  regions?: string[];
  areaTypes?: string[];
}

/**
 * TripConditionsを受け取り、条件に合致する行き先候補を6つランダムに生成する。
 * 現在はDB等がないため、擬似的にフィルタリング（全県からランダム抽出）を行う。
 */
export function generateDestinationCandidates(
  conditions?: TripConditions,
  options?: ShuffleOptions,
): DestinationCandidate[] {
  let pool = [...PREFECTURES];

  if (options?.regions && options.regions.length > 0) {
    pool = pool.filter((p) => options.regions?.includes(p.region));
  }
  if (options?.areaTypes && options.areaTypes.length > 0) {
    pool = pool.filter((p) => options.areaTypes?.includes(p.areaType));
  }

  // 候補が6つ未満の場合は不足分を全体から補う
  if (pool.length < 6) {
    const additional = PREFECTURES.filter((p) => !pool.find((x) => x.id === p.id));
    for (let i = pool.length; i < 6; i++) {
      const idx = Math.floor(Math.random() * additional.length);
      pool.push(additional.splice(idx, 1)[0]);
    }
  }

  // シャッフル
  for (let i = 0; i < 6 && i < pool.length; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }

  return pool.slice(0, 6).map((pref, _idx) => {
    const prefCode = pref.id.toString().padStart(2, "0");
    return {
      id: `candidate-${pref.id}-${Date.now()}`,
      prefectureCode: prefCode,
      prefecture: pref.name,
      location: MOCK_LOCATIONS[pref.id] || { lat: 35.0, lng: 135.0 }, // デフォルト値
      tags: conditions?.themes || ["観光", "自然"],
      description: `${pref.name}のおすすめスポット。`,
    };
  });
}
