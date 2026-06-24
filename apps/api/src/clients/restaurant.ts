import { type Restaurant, RestaurantSchema } from "@repo/shared";
import { z } from "zod";
import { ApiClientBase } from "./base";

/**
 * 飲食店クライアント。
 * ホットペッパー グルメサーチ API を利用して、周辺のレストラン情報を取得します。
 * APIキーが設定されていない場合は、自動的に検索をスキップして空配列を返します。
 */
export class RestaurantClient extends ApiClientBase {
  private apiKey?: string;

  constructor(config: { apiKey?: string; kv?: KVNamespace }) {
    super(config.kv);
    this.apiKey = config.apiKey;
  }

  /**
   * 指定した緯度経度の周辺にある飲食店を検索します。
   * @param lat 緯度
   * @param lng 経度
   * @param range 検索範囲コード (1: 300m, 2: 500m, 3: 1000m, 4: 2000m, 5: 3000m)
   * @param count 最大取得件数 (1 〜 100)
   */
  async searchRestaurants(lat: number, lng: number, range = 3, count = 10): Promise<Restaurant[]> {
    if (!this.apiKey) {
      console.warn("[RestaurantClient] Hotpepper API key is not set. Skipping search.");
      return [];
    }

    // 範囲コードを 1 〜 5 の範囲に制限
    const checkedRange = Math.min(5, Math.max(1, range));
    const checkedCount = Math.min(100, Math.max(1, count));
    const cacheKey = `api:restaurant:${lat.toFixed(6)}:${lng.toFixed(6)}:${checkedRange}:${checkedCount}`;

    return this.withCache(
      cacheKey,
      604800, // キャッシュTTL: 7日間 (604800秒)
      async () => {
        const url = `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?key=${
          this.apiKey
        }&lat=${lat}&lng=${lng}&range=${checkedRange}&count=${checkedCount}&format=json`;

        const response = await this.fetchWithRetry(url);
        if (!response.ok) {
          throw new Error(`Hotpepper API returned status ${response.status}`);
        }

        // biome-ignore lint/suspicious/noExplicitAny: response structure is dynamic
        const data = (await response.json()) as any;
        if (!data.results || !Array.isArray(data.results.shop)) {
          return [];
        }

        const restaurants: Restaurant[] = [];
        for (const shop of data.results.shop) {
          const budget = this.parseBudget(shop.budget);

          restaurants.push({
            id: shop.id,
            name: shop.name || "不明な飲食店",
            genre: shop.genre?.name || undefined,
            point:
              shop.lat && shop.lng
                ? {
                    lat: typeof shop.lat === "number" ? shop.lat : parseFloat(shop.lat),
                    lng: typeof shop.lng === "number" ? shop.lng : parseFloat(shop.lng),
                  }
                : undefined,
            budget,
            url: shop.urls?.pc || undefined,
            image: shop.photo?.pc?.l
              ? {
                  url: shop.photo.pc.l,
                  thumbUrl: shop.photo.pc.m || shop.photo.pc.s || undefined,
                  generated: false,
                }
              : undefined,
            source: "hotpepper",
          });
        }

        return restaurants;
      },
      z.array(RestaurantSchema),
    );
  }

  /**
   * ホットペッパーの予算データを Money 形式にパース/マッピングします
   */
  private parseBudget(
    budget: unknown,
  ): { amount: number; currency: "JPY"; approx: boolean } | undefined {
    if (!budget || typeof budget !== "object") return undefined;
    const b = budget as Record<string, unknown>;

    // 予算コード (code) からの代表金額マッピング
    const budgetMap: Record<string, number> = {
      B010: 500, // ～500円
      B011: 1000, // 501～1000円
      B001: 1500, // 1001～1500円
      B002: 2500, // 2001～3000円
      B003: 3500, // 3001～4000円
      B008: 4500, // 4001～5000円
      B004: 6000, // 5001～7000円
      B005: 8500, // 7001～10000円
      B006: 12500, // 10001～15000円
      B012: 17500, // 15001～20000円
      B007: 25000, // 20001～30000円
      B013: 30000, // 30001円～
    };

    const code = typeof b.code === "string" ? b.code : undefined;
    const amount = code ? budgetMap[code] : undefined;
    if (amount !== undefined) {
      return {
        amount,
        currency: "JPY" as const,
        approx: true,
      };
    }

    // コードから取れない場合は、テキスト名から金額の数値を推測
    const name = typeof b.name === "string" ? b.name : undefined;
    if (name) {
      const match = name.match(/(\d+)[～-]/) || name.match(/(\d+)円/);
      if (match) {
        return {
          amount: Number.parseInt(match[1] || "0", 10),
          currency: "JPY" as const,
          approx: true,
        };
      }
    }

    return undefined;
  }
}
