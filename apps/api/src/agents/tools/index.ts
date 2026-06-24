import type { Bindings } from "../../env";
import { buildCalculate } from "./calculate";
import type { ToolContext } from "./context";
import { buildGoogleMaps } from "./google-maps";
import { buildHotelSearch } from "./hotel-search";
import { buildImageSearch } from "./image-search";
import { buildRestaurantSearch } from "./restaurant-search";
import { buildTouristSpotSearch } from "./tourist-spot-search";
import { buildTransportationSearch } from "./transportation-search";
import { buildWeatherSearch } from "./weather-search";

export function buildTools(_env: Bindings, ctx: ToolContext) {
  // context is already populated with clients, usage, etc.
  return {
    touristSpotSearch: buildTouristSpotSearch(ctx),
    hotelSearch: buildHotelSearch(ctx),
    restaurantSearch: buildRestaurantSearch(ctx),
    transportationSearch: buildTransportationSearch(ctx),
    weather: buildWeatherSearch(ctx),
    imageSearch: buildImageSearch(ctx),
    googleMaps: buildGoogleMaps(ctx),
    calculate: buildCalculate(ctx),
  };
}

export * from "./context";
