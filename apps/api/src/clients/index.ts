import type { Bindings } from "../env";
import { GeocodingClient } from "./geocoding";
import { ImageClient } from "./image";
import { LodgingClient } from "./lodging";
import { PoiClient } from "./poi";
import { RestaurantClient } from "./restaurant";
import { TransitClient } from "./transit";
import { WeatherClient } from "./weather";

export * from "./base";
export * from "./geocoding";
export * from "./image";
export * from "./lodging";
export * from "./poi";
export * from "./restaurant";
export * from "./transit";
export * from "./weather";

/**
 * Hono の環境変数 (Bindings) からすべての API クライアントインスタンスを一括生成するファクトリ関数。
 */
export function createClients(env: Bindings) {
  return {
    geocoding: new GeocodingClient({
      apiKey: env.GOOGLE_MAPS_API_KEY,
      kv: env.KV,
    }),
    poi: new PoiClient({
      googleApiKey: env.GOOGLE_MAPS_API_KEY,
      foursquareKey: env.FOUTSQUARE_KEY,
      kv: env.KV,
    }),
    weather: new WeatherClient({
      kv: env.KV,
    }),
    lodging: new LodgingClient({
      applicationId: env.RAKUTEN_APP_ID,
      kv: env.KV,
    }),
    restaurant: new RestaurantClient({
      apiKey: env.HOTTOPEPPER_KEY,
      kv: env.KV,
    }),
    transit: new TransitClient({
      googleApiKey: env.GOOGLE_MAPS_API_KEY,
      odptApiKey: env.ODPT_API_KEY,
      kv: env.KV,
    }),
    image: new ImageClient({
      unsplashAccessKey: env.UNSPLASH_ACCESS_KEY,
      pexelsApiKey: env.PEXELS_API_KEY,
      kv: env.KV,
    }),
  };
}
