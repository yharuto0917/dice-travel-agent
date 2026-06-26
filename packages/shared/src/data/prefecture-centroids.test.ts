import { describe, expect, it } from "vitest";
import { GeoPointSchema } from "../schemas/common";
import { PREFECTURE_CENTROIDS, prefectureCentroid } from "./prefecture-centroids";

describe("prefectureCentroid", () => {
  it("全47都道府県コード（01〜47）を網羅し、各座標が GeoPoint として妥当", () => {
    for (let i = 1; i <= 47; i++) {
      const code = i.toString().padStart(2, "0");
      const point = PREFECTURE_CENTROIDS[code];
      expect(point, `コード ${code} の座標が無い`).toBeDefined();
      expect(GeoPointSchema.safeParse(point).success).toBe(true);
    }
    expect(Object.keys(PREFECTURE_CENTROIDS)).toHaveLength(47);
  });

  it("既知コードは座標を返す", () => {
    expect(prefectureCentroid("13")).toEqual({ lat: 35.6895, lng: 139.6917 });
  });

  it("未知コード・null・undefined は null を返す（フォールバック失敗を握りつぶさない）", () => {
    expect(prefectureCentroid("48")).toBeNull();
    expect(prefectureCentroid(null)).toBeNull();
    expect(prefectureCentroid(undefined)).toBeNull();
    expect(prefectureCentroid("")).toBeNull();
  });
});
