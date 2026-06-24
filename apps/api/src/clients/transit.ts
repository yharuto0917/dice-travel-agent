import { type GeoPoint, type TransportLeg, TransportLegSchema } from "@repo/shared";
import { z } from "zod";
import { ApiClientBase } from "./base";

/**
 * 交通/経路クライアント。
 * Google Maps API キーが設定されている場合は Google Directions API を使用し、
 * 設定されていない場合は緯度経度から直線距離を算出して、時間と料金を概算します。
 */
export class TransitClient extends ApiClientBase {
  private googleApiKey?: string;

  constructor(config: { googleApiKey?: string; kv?: KVNamespace }) {
    super(config.kv);
    this.googleApiKey = config.googleApiKey;
  }

  /**
   * 2地点間の経路情報を取得します。
   */
  async getDirections(
    from: GeoPoint,
    to: GeoPoint,
    fromName: string,
    toName: string,
    mode: "walk" | "transit" | "car" | "bicycle" | "other" = "transit",
  ): Promise<TransportLeg[]> {
    const cacheKey = `api:transit:${from.lat.toFixed(6)}:${from.lng.toFixed(6)}:${to.lat.toFixed(6)}:${to.lng.toFixed(6)}:${mode}`;

    return this.withCache(
      cacheKey,
      604800, // キャッシュTTL: 7日間 (604800秒)
      async () => {
        if (this.googleApiKey) {
          try {
            return await this.getDirectionsWithGoogle(from, to, fromName, toName, mode);
          } catch (error) {
            console.error(
              "[TransitClient] Google Directions failed, falling back to estimation:",
              error,
            );
          }
        }
        return this.estimateDirections(from, to, fromName, toName, mode);
      },
      z.array(TransportLegSchema),
    );
  }

  /**
   * Google Directions API を用いた経路取得
   */
  private async getDirectionsWithGoogle(
    from: GeoPoint,
    to: GeoPoint,
    fromName: string,
    toName: string,
    mode: "walk" | "transit" | "car" | "bicycle" | "other",
  ): Promise<TransportLeg[]> {
    const googleModeMap: Record<string, string> = {
      walk: "walking",
      transit: "transit",
      car: "driving",
      bicycle: "bicycling",
      other: "transit",
    };

    const gMode = googleModeMap[mode] || "transit";
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&mode=${gMode}&language=ja&key=${this.googleApiKey}`;

    const response = await this.fetchWithRetry(url);
    if (!response.ok) {
      throw new Error(`Google Directions API returned status ${response.status}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: response structure is dynamic
    const data = (await response.json()) as any;
    if (data.status !== "OK" || !data.routes || data.routes.length === 0) {
      throw new Error(`Google Directions API returned status ${data.status}`);
    }

    const route = data.routes[0];
    const leg = route.legs?.[0];
    if (!leg) {
      return [];
    }

    const modeMapping: Record<string, "walk" | "transit" | "car" | "bicycle" | "other"> = {
      WALKING: "walk",
      TRANSIT: "transit",
      DRIVING: "car",
      BICYCLING: "bicycle",
    };

    // 全体の運賃（存在する場合）を取得
    const totalFare = route.fare
      ? {
          amount:
            typeof route.fare.value === "number" ? route.fare.value : parseFloat(route.fare.value),
          currency: "JPY" as const,
          approx: true,
        }
      : undefined;

    // ステップごとに細分化した経路を作成
    if (leg.steps && Array.isArray(leg.steps) && leg.steps.length > 0) {
      // biome-ignore lint/suspicious/noExplicitAny: steps structure is dynamic
      const legs: TransportLeg[] = leg.steps.map((step: any, idx: number): TransportLeg => {
        const stepMode = modeMapping[step.travel_mode] || "other";

        // 最初のステップまたは特定のステップに運賃を付与する（全体運賃がある場合）
        // ここでは最初の transit ステップに運賃を付与
        const isFirstTransit =
          stepMode === "transit" &&
          // biome-ignore lint/suspicious/noExplicitAny: step structure is dynamic
          !leg.steps.slice(0, idx).some((s: any) => modeMapping[s.travel_mode] === "transit");
        const cost = isFirstTransit ? totalFare : undefined;

        // 電車などの場合は駅名・停留所名を採用
        const stepFrom =
          step.transit_details?.departure_stop?.name || (idx === 0 ? fromName : "中間地点");
        const stepTo =
          step.transit_details?.arrival_stop?.name ||
          (idx === leg.steps.length - 1 ? toName : "中間地点");

        return {
          mode: stepMode,
          fromName: stepFrom,
          toName: stepTo,
          durationMin: this.secondsToDurationMin(step.duration?.value),
          distanceKm: this.metersToDistanceKm(step.distance?.value),
          cost,
          source: "google",
        };
      });
      return legs;
    }

    // ステップがない場合は全体を1つのLegとして返す
    return [
      {
        mode: mode === "other" ? "transit" : mode,
        fromName,
        toName,
        durationMin: this.secondsToDurationMin(leg.duration?.value),
        distanceKm: this.metersToDistanceKm(leg.distance?.value),
        cost: totalFare,
        source: "google",
      },
    ];
  }

  /**
   * 緯度経度からの直線距離計算と時間・料金の概算（フォールバック）
   */
  private estimateDirections(
    from: GeoPoint,
    to: GeoPoint,
    fromName: string,
    toName: string,
    mode: "walk" | "transit" | "car" | "bicycle" | "other",
  ): Promise<TransportLeg[]> {
    // ハーバーサインの公式で直線距離 (km) を計算
    const distanceKm = this.calculateDistance(from.lat, from.lng, to.lat, to.lng);
    // 直線距離に対し、実際の道路に沿った移動距離を補正（およそ 1.25 倍）
    const actualDistanceKm = parseFloat((distanceKm * 1.25).toFixed(2));

    let speedKmH = 4.0; // 徒歩
    let costAmount = 0;

    switch (mode) {
      case "walk":
        speedKmH = 4.0;
        costAmount = 0;
        break;
      case "car":
        speedKmH = 40.0;
        // 簡易有料道路料金概算 (20km以上は高速代として適当に加算)
        costAmount = actualDistanceKm > 20 ? Math.round(500 + actualDistanceKm * 20) : 0;
        break;
      case "bicycle":
        speedKmH = 15.0;
        costAmount = 0;
        break;
      default:
        speedKmH = 30.0;
        // 電車/バスの簡易運賃計算 (初乗り 150円 + 1kmにつき 20円)
        costAmount = actualDistanceKm > 0 ? Math.round(150 + actualDistanceKm * 20) : 0;
        break;
    }

    // 所要時間 (分) = (距離 / 時速) * 60
    // 最低1分、公共交通機関の場合は乗り換え待ち時間として 10分を固定で加算
    let durationMin = Math.round((actualDistanceKm / speedKmH) * 60);
    if (mode === "transit" || mode === "other") {
      durationMin = Math.max(10, durationMin + 10);
    } else {
      durationMin = Math.max(1, durationMin);
    }

    const cost =
      costAmount > 0 ? { amount: costAmount, currency: "JPY" as const, approx: true } : undefined;

    const leg: TransportLeg = {
      mode: mode === "other" ? "transit" : mode,
      fromName,
      toName,
      durationMin,
      distanceKm: actualDistanceKm,
      cost,
      // 直線距離からの概算値であり、実APIの裏付けがないため出所(source)は付与しない。
      // 将来 ODPT 等で実データ取得を実装した際に該当 source を設定する。
      source: undefined,
    };

    return Promise.resolve([leg]);
  }

  /**
   * 2点間の直線距離 (km) を計算 (ハーバーサインの公式)
   */
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // 地球の半径 (km)
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Google Directions の秒数を所要時間(分)へ変換する。
   * 値が欠落・非数値のステップ（運賃のみ等）では NaN を作らず undefined を返し、
   * TransportLegSchema(durationMin は optional な int) の検証失敗を防ぐ。
   */
  private secondsToDurationMin(seconds: unknown): number | undefined {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return undefined;
    return Math.max(1, Math.round(seconds / 60));
  }

  /**
   * Google Directions のメートル値を距離(km)へ変換する。
   * 値が欠落・非数値の場合は undefined を返す（distanceKm も optional のため）。
   */
  private metersToDistanceKm(meters: unknown): number | undefined {
    if (typeof meters !== "number" || !Number.isFinite(meters)) return undefined;
    return Number.parseFloat((meters / 1000).toFixed(2));
  }
}
