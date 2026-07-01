import { type GeoPoint, GeoPointSchema } from "@repo/shared";
import { ApiClientBase } from "./base";

/**
 * ジオコーディングクライアント。
 * APIキーが存在する場合は Google Geocoding API を、
 * 存在しない場合は国土地理院の住所検索APIを使用します。
 */
export class GeocodingClient extends ApiClientBase {
  private apiKey?: string;

  constructor(config: { apiKey?: string; kv?: KVNamespace }) {
    super(config.kv);
    this.apiKey = config.apiKey;
  }

  /**
   * 住所や地名から緯度経度を取得します。
   */
  async geocode(query: string): Promise<GeoPoint | null> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return null;

    const cacheKey = `api:geocoding:${encodeURIComponent(trimmedQuery)}`;
    // キャッシュTTL: 7日間 (604800秒)
    return this.withCache(
      cacheKey,
      604800,
      async () => {
        if (this.apiKey) {
          try {
            return await this.geocodeWithGoogle(trimmedQuery);
          } catch (error) {
            console.error("[GeocodingClient] Google Geocoding failed, falling back to GSI:", error);
            return this.geocodeWithGsi(trimmedQuery);
          }
        } else {
          return this.geocodeWithGsi(trimmedQuery);
        }
      },
      GeoPointSchema.nullable(),
    );
  }

  /**
   * Google Geocoding API を用いたジオコーディング
   */
  private async geocodeWithGoogle(query: string): Promise<GeoPoint | null> {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      query,
    )}&key=${this.apiKey}`;
    const response = await this.fetchWithRetry(url);
    if (!response.ok) {
      throw new Error(`Google Geocoding API returned status ${response.status}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: response structure is dynamic
    const data = (await response.json()) as any;
    if (data.status !== "OK" || !data.results || data.results.length === 0) {
      return null;
    }

    const location = data.results[0].geometry.location;
    return {
      lat: location.lat,
      lng: location.lng,
    };
  }

  /**
   * 国土地理院 (GSI) の住所検索 API を用いたジオコーディング
   */
  private async geocodeWithGsi(query: string): Promise<GeoPoint | null> {
    const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(
      query,
    )}`;
    const response = await this.fetchWithRetry(url);
    if (!response.ok) {
      throw new Error(`GSI Geocoding API returned status ${response.status}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: response structure is dynamic
    const data = (await response.json()) as any;
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    const first = data[0];
    if (
      !first.geometry ||
      !Array.isArray(first.geometry.coordinates) ||
      first.geometry.coordinates.length < 2
    ) {
      return null;
    }

    // 国土地理院の座標は [経度(lng), 緯度(lat)] の順序です
    const [lng, lat] = first.geometry.coordinates;
    return {
      lat,
      lng,
    };
  }
}
