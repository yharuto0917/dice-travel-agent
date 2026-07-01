import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";

export function buildHotelSearch(ctx: ToolContext) {
  return tool({
    description: "Search for hotels or lodging near a specific location.",
    inputSchema: z.object({
      lat: z.number().describe("Latitude of the center point"),
      lng: z.number().describe("Longitude of the center point"),
      radiusKm: z.number().optional().describe("Search radius in kilometers (default: 3.0)"),
    }),
    execute: async ({ lat, lng, radiusKm = 3.0 }) => {
      ctx.usage.tool();
      return await ctx.clients.lodging.searchHotels(lat, lng, radiusKm);
    },
  });
}
