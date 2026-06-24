import { type Poi, PoiSchema } from "@repo/shared";
import { z } from "zod";
import { ApiClientBase } from "./base";

/**
 * 観光/POIクライアント。
 * Google Maps API キーが設定されている場合は Google Places API を使用し、
 * 設定されていない場合は Foursquare Places API を使用します。
 */
export class PoiClient extends ApiClientBase {
  private googleApiKey?: string;
  private foursquareKey?: string;

  constructor(config: { googleApiKey?: string; foursquareKey?: string; kv?: KVNamespace }) {
    super(config.kv);
    this.googleApiKey = config.googleApiKey;
    this.foursquareKey = config.foursquareKey;
  }

  /**
   * 指定した緯度経度の周辺にある観光スポットを検索します。
   */
  async searchNearby(lat: number, lng: number, radius = 1000): Promise<Poi[]> {
    const cacheKey = `api:poi:${lat.toFixed(6)}:${lng.toFixed(6)}:${radius}`;
    return this.withCache(
      cacheKey,
      604800, // キャッシュTTL: 7日間 (604800秒)
      async () => {
        if (this.googleApiKey) {
          try {
            return await this.searchWithGoogle(lat, lng, radius);
          } catch (error) {
            console.error(
              "[PoiClient] Google Places API failed, falling back to Foursquare:",
              error,
            );
            if (this.foursquareKey) {
              try {
                return await this.searchWithFoursquare(lat, lng, radius);
              } catch (fsqError) {
                console.error(
                  "[PoiClient] Foursquare Places API failed after Google fallback:",
                  fsqError,
                );
              }
            }
          }
        } else if (this.foursquareKey) {
          try {
            return await this.searchWithFoursquare(lat, lng, radius);
          } catch (fsqError) {
            console.error("[PoiClient] Foursquare Places API failed:", fsqError);
          }
        }
        console.warn("[PoiClient] No available APIs or both failed for POI search.");
        return [];
      },
      z.array(PoiSchema),
    );
  }

  /**
   * Google Places API (New) を用いた周辺観光地検索
   */
  private async searchWithGoogle(lat: number, lng: number, radius: number): Promise<Poi[]> {
    const url = "https://places.googleapis.com/v1/places:searchNearby";
    const body = {
      includedTypes: [
        "tourist_attraction",
        "park",
        "museum",
        "amusement_park",
        "landmark",
        "historical_landmark",
      ],
      maxResultCount: 10,
      locationRestriction: {
        circle: {
          center: {
            latitude: lat,
            longitude: lng,
          },
          radius: radius,
        },
      },
    };

    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.googleApiKey || "",
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.priceLevel,places.websiteUri",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Google Places API returned status ${response.status}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: response structure is dynamic
    const data = (await response.json()) as any;
    if (!data.places || !Array.isArray(data.places)) {
      return [];
    }

    // biome-ignore lint/suspicious/noExplicitAny: response structure is dynamic
    return data.places.map((place: any): Poi => {
      let priceLevel: number | undefined;
      if (place.priceLevel) {
        const mapping: Record<string, number> = {
          PRICE_LEVEL_FREE: 0,
          PRICE_LEVEL_INEXPENSIVE: 1,
          PRICE_LEVEL_MODERATE: 2,
          PRICE_LEVEL_EXPENSIVE: 3,
          PRICE_LEVEL_VERY_EXPENSIVE: 4,
        };
        priceLevel = mapping[place.priceLevel];
      }

      return {
        id: place.id,
        name: place.displayName?.text || "不明なスポット",
        point: {
          lat: place.location?.latitude || lat,
          lng: place.location?.longitude || lng,
        },
        address: place.formattedAddress,
        rating: place.rating,
        priceLevel,
        url: place.websiteUri,
        source: "google",
      };
    });
  }

  /**
   * Foursquare Places API を用いた周辺観光地検索
   */
  private async searchWithFoursquare(lat: number, lng: number, radius: number): Promise<Poi[]> {
    // 観光（Arts and Entertainment: 10000, Landmarks and Outdoors: 16000）
    const categories = "10000,16000";
    const url = `https://api.foursquare.com/v3/places/search?ll=${lat},${lng}&radius=${radius}&categories=${categories}&limit=10`;

    const response = await this.fetchWithRetry(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: this.foursquareKey || "",
      },
    });

    if (!response.ok) {
      throw new Error(`Foursquare Places API returned status ${response.status}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: response structure is dynamic
    const data = (await response.json()) as any;
    if (!data.results || !Array.isArray(data.results)) {
      return [];
    }

    // biome-ignore lint/suspicious/noExplicitAny: response structure is dynamic
    return data.results.map((item: any): Poi => {
      const poiLat = item.geocodes?.main?.latitude ?? lat;
      const poiLng = item.geocodes?.main?.longitude ?? lng;

      return {
        id: item.fsq_id,
        name: item.name || "不明なスポット",
        point: {
          lat: poiLat,
          lng: poiLng,
        },
        address: item.location?.formatted_address,
        rating: item.rating ? item.rating / 2 : undefined, // Foursquare rating は 10点満点のため 5点満点に変換
        priceLevel: item.price, // Foursquare price は 1〜4
        url: undefined,
        source: "foursquare",
      };
    });
  }
}
