import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";

export function buildWeatherSearch(ctx: ToolContext) {
  return tool({
    description: "Get daily weather forecast for a location.",
    inputSchema: z.object({
      lat: z.number().describe("Latitude of the location"),
      lng: z.number().describe("Longitude of the location"),
    }),
    execute: async ({ lat, lng }) => {
      ctx.usage.tool();
      return await ctx.clients.weather.getForecast(lat, lng);
    },
  });
}
