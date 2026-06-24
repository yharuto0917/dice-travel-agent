import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";

export function buildTouristSpotSearch(ctx: ToolContext) {
  return tool({
    description:
      "Search for tourist spots, sightseeing locations, or points of interest near a specific location.",
    inputSchema: z.object({
      lat: z.number().describe("Latitude of the center point"),
      lng: z.number().describe("Longitude of the center point"),
      radius: z.number().optional().describe("Search radius in meters (default: 1000)"),
    }),
    execute: async ({ lat, lng, radius = 1000 }) => {
      ctx.usage.tool();
      return await ctx.clients.poi.searchNearby(lat, lng, radius);
    },
  });
}
