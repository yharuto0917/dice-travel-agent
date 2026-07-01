import { type WeatherDaily, WeatherDailySchema } from "@repo/shared";
import { z } from "zod";
import { ApiClientBase } from "./base";

/**
 * 天気クライアント。
 * キー不要で利用可能な Open-Meteo API を基盤とし、
 * エラーやサービス停止時には気象庁 (JMA) の天気予報 API にフォールバックします。
 */
export class WeatherClient extends ApiClientBase {
  constructor(config: { kv?: KVNamespace }) {
    super(config.kv);
  }

  /**
   * 指定した緯度経度の天気予報（日別）を取得します。
   */
  async getForecast(lat: number, lng: number): Promise<WeatherDaily[]> {
    const cacheKey = `api:weather:${lat.toFixed(4)}:${lng.toFixed(4)}`;
    // キャッシュTTL: 3時間 (10800秒)
    return this.withCache(
      cacheKey,
      10800,
      async () => {
        try {
          return await this.getForecastFromOpenMeteo(lat, lng);
        } catch (error) {
          console.error("[WeatherClient] Open-Meteo failed, falling back to JMA:", error);
          try {
            return await this.getForecastFromJma(lat, lng);
          } catch (jmaError) {
            console.error("[WeatherClient] JMA fallback failed:", jmaError);
            throw new Error(`Weather API failed: Both Open-Meteo and JMA failed.`);
          }
        }
      },
      z.array(WeatherDailySchema),
    );
  }

  /**
   * Open-Meteo API からの天気予報取得
   */
  private async getForecastFromOpenMeteo(lat: number, lng: number): Promise<WeatherDaily[]> {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia/Tokyo`;
    const response = await this.fetchWithRetry(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo returned status ${response.status}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: response structure is dynamic
    const data = (await response.json()) as any;
    if (!data.daily || !Array.isArray(data.daily.time)) {
      return [];
    }

    const daily = data.daily;
    const result: WeatherDaily[] = [];

    for (let i = 0; i < daily.time.length; i++) {
      result.push({
        date: daily.time[i],
        tempMaxC: daily.temperature_2m_max?.[i],
        tempMinC: daily.temperature_2m_min?.[i],
        condition: this.mapWmoCodeToCondition(daily.weather_code?.[i]),
        precipitationProbPct: daily.precipitation_probability_max?.[i],
        source: "openmeteo",
      });
    }

    return result;
  }

  /**
   * 気象庁 (JMA) API からの天気予報取得（フォールバック）
   */
  private async getForecastFromJma(lat: number, lng: number): Promise<WeatherDaily[]> {
    const areaCode = this.getNearestJmaAreaCode(lat, lng);
    const url = `https://www.jma.go.jp/bosai/forecast/data/forecast/${areaCode}.json`;
    const response = await this.fetchWithRetry(url);
    if (!response.ok) {
      throw new Error(`JMA API returned status ${response.status}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: response structure is dynamic
    const data = (await response.json()) as any;
    if (!Array.isArray(data) || data.length === 0 || !data[0].timeSeries) {
      return [];
    }

    // data[0].timeSeries[0] に日付と天気が入っている
    const timeSeries = data[0].timeSeries[0];
    const timeDefines = timeSeries.timeDefines || [];
    const areaData = timeSeries.areas?.[0] || {};
    const weathers = areaData.weathers || [];

    // data[0].timeSeries[2] が存在する場合に最高・最低気温の取得を試みる
    // biome-ignore lint/suspicious/noExplicitAny: JMA API response is nested and dynamic
    const tempTimeSeries = data[0].timeSeries.find((ts: any) => ts.areas?.[0]?.temps);
    const temps = tempTimeSeries?.areas?.[0]?.temps || [];

    const result: WeatherDaily[] = [];
    const maxDays = Math.min(timeDefines.length, 3); // JMAの予報は大体3日間

    for (let i = 0; i < maxDays; i++) {
      const date = timeDefines[i].substring(0, 10); // YYYY-MM-DD
      const condition = weathers[i] ? weathers[i].replace(/\s+/g, " ") : "不明";

      result.push({
        date,
        condition,
        // 気象庁の単純な気温データは最高/最低が混在するため、取得できた場合のみ簡易マッピング
        tempMaxC: temps[i * 2] ? parseFloat(temps[i * 2]) : undefined,
        tempMinC: temps[i * 2 + 1] ? parseFloat(temps[i * 2 + 1]) : undefined,
        precipitationProbPct: undefined, // JMAの降水確率は別timeSeriesにあるため、フォールバックでは省略
        source: "jma",
      });
    }

    return result;
  }

  /**
   * WMO 天気コードから日本語の天気条件文字列へのマッピング
   */
  private mapWmoCodeToCondition(code: number): string {
    if (code === 0) return "晴れ";
    if (code >= 1 && code <= 3) return "晴れ時々曇り";
    if (code === 45 || code === 48) return "霧";
    if (code >= 51 && code <= 57) return "霧雨";
    if (code >= 61 && code <= 67) return "雨";
    if (code >= 71 && code <= 77) return "雪";
    if (code >= 80 && code <= 82) return "俄か雨";
    if (code >= 85 && code <= 86) return "俄か雪";
    if (code >= 95 && code <= 99) return "雷雨";
    return "曇り";
  }

  /**
   * 緯度経度から最も近い気象庁の主要予報エリアコードを取得する簡易マッピング
   */
  private getNearestJmaAreaCode(lat: number, lng: number): string {
    const stations = [
      { name: "札幌", lat: 43.06, lng: 141.35, code: "016000" },
      { name: "仙台", lat: 38.26, lng: 140.87, code: "040000" },
      { name: "東京", lat: 35.68, lng: 139.69, code: "130000" },
      { name: "名古屋", lat: 35.18, lng: 136.9, code: "230000" },
      { name: "大阪", lat: 34.69, lng: 135.5, code: "270000" },
      { name: "広島", lat: 34.39, lng: 132.45, code: "340000" },
      { name: "福岡", lat: 33.6, lng: 130.4, code: "400000" },
      { name: "那覇", lat: 26.21, lng: 127.67, code: "471000" },
    ];

    let minDistance = Infinity;
    let nearestCode = "130000"; // デフォルト: 東京

    for (const station of stations) {
      const distance = (station.lat - lat) ** 2 + (station.lng - lng) ** 2;
      if (distance < minDistance) {
        minDistance = distance;
        nearestCode = station.code;
      }
    }

    return nearestCode;
  }
}
