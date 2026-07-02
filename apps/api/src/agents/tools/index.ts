import { buildCalculate } from "./calculate";
import type { ToolContext } from "./context";
import { buildGoogleMaps } from "./google-maps";
import { buildHotelSearch } from "./hotel-search";
import { buildImageSearch } from "./image-search";
import { buildGenerateImage } from "./generate-image";
import { buildRestaurantSearch } from "./restaurant-search";
import { buildTouristSpotSearch } from "./tourist-spot-search";
import { buildTransportationSearch } from "./transportation-search";
import { buildWeatherSearch } from "./weather-search";

export function buildTools(ctx: ToolContext) {
  // ctx は clients / usage 等を保持済み（env は不要）。
  return {
    touristSpotSearch: buildTouristSpotSearch(ctx),
    hotelSearch: buildHotelSearch(ctx),
    restaurantSearch: buildRestaurantSearch(ctx),
    transportationSearch: buildTransportationSearch(ctx),
    weather: buildWeatherSearch(ctx),
    imageSearch: buildImageSearch(ctx),
    generateImage: buildGenerateImage(ctx),
    googleMaps: buildGoogleMaps(ctx),
    calculate: buildCalculate(ctx),
  };
}

export * from "./context";
