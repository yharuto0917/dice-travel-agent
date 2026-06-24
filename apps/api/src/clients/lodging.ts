import { type Lodging, LodgingSchema } from "@repo/shared";
import { z } from "zod";
import { ApiClientBase } from "./base";

/**
 * 宿泊施設クライアント。
 * 楽天トラベル 施設検索 API を利用して、周辺のホテル情報を取得します。
 * アプリケーションIDが設定されていない場合は、自動的に検索をスキップして空配列を返します。
 */
export class LodgingClient extends ApiClientBase {
  private applicationId?: string;

  constructor(config: { applicationId?: string; kv?: KVNamespace }) {
    super(config.kv);
    this.applicationId = config.applicationId;
  }

  /**
   * 指定した緯度経度の周辺にある宿泊施設を検索します。
   * @param lat 緯度
   * @param lng 経度
   * @param searchRadius 検索半径 (km, 0.1 〜 3.0)
   */
  async searchHotels(lat: number, lng: number, searchRadius = 3.0): Promise<Lodging[]> {
    if (!this.applicationId) {
      console.warn("[LodgingClient] Rakuten Travel applicationId is not set. Skipping search.");
      return [];
    }

    // 楽天トラベル API の制限に合わせて 0.1 〜 3.0 の範囲に丸める
    const radius = Math.min(3.0, Math.max(0.1, searchRadius));
    const cacheKey = `api:lodging:${lat.toFixed(6)}:${lng.toFixed(6)}:${radius}`;

    return this.withCache(
      cacheKey,
      604800, // キャッシュTTL: 7日間 (604800秒)
      async () => {
        const url = `https://app.rakuten.co.jp/services/api/Travel/SimpleHotelSearch/20170426?applicationId=${
          this.applicationId
        }&format=json&latitude=${lat}&longitude=${lng}&searchRadius=${radius}&datumType=1`;

        const response = await this.fetchWithRetry(url);
        if (!response.ok) {
          // ホテルが見つからない場合などに 404 (またはそれに類するエラー) が返される場合があるため、
          // その場合はエラーにせず空配列を返します
          if (response.status === 404) {
            return [];
          }
          throw new Error(`Rakuten Travel API returned status ${response.status}`);
        }

        // biome-ignore lint/suspicious/noExplicitAny: response structure is dynamic
        const data = (await response.json()) as any;
        if (!data.hotels || !Array.isArray(data.hotels)) {
          return [];
        }

        const lodgings: Lodging[] = [];
        for (const item of data.hotels) {
          const hotelInfo = item.hotel?.[0]?.hotelBasicInfo;
          if (!hotelInfo) continue;

          // 最低料金を取得してMoney型にマッピング
          const minCharge = hotelInfo.hotelMinCharge;
          const pricePerNight = minCharge
            ? {
                amount: typeof minCharge === "number" ? minCharge : parseInt(minCharge, 10),
                currency: "JPY" as const,
                approx: true,
              }
            : undefined;

          // 評価のパース
          let rating: number | undefined;
          if (hotelInfo.reviewAverage) {
            const parsedRating = parseFloat(hotelInfo.reviewAverage);
            if (!Number.isNaN(parsedRating) && parsedRating >= 0 && parsedRating <= 5) {
              rating = parsedRating;
            }
          }

          lodgings.push({
            id: String(hotelInfo.hotelNo),
            name: hotelInfo.hotelName || "不明な宿泊施設",
            point:
              hotelInfo.latitude && hotelInfo.longitude
                ? {
                    lat:
                      typeof hotelInfo.latitude === "number"
                        ? hotelInfo.latitude
                        : parseFloat(hotelInfo.latitude),
                    lng:
                      typeof hotelInfo.longitude === "number"
                        ? hotelInfo.longitude
                        : parseFloat(hotelInfo.longitude),
                  }
                : undefined,
            pricePerNight,
            rating,
            url: hotelInfo.hotelInformationUrl || undefined,
            image: hotelInfo.hotelImageUrl
              ? {
                  url: hotelInfo.hotelImageUrl,
                  thumbUrl: hotelInfo.hotelThumbnailUrl || undefined,
                  generated: false,
                }
              : undefined,
            source: "rakuten",
          });
        }

        return lodgings;
      },
      z.array(LodgingSchema),
    );
  }
}
