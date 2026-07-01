import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";

export function buildRestaurantSearch(ctx: ToolContext) {
  return tool({
    description: "Search for restaurants near a specific location.",
    inputSchema: z.object({
      lat: z.number().describe("Latitude of the center point"),
      lng: z.number().describe("Longitude of the center point"),
      range: z.number().min(1).max(5).optional().describe("Search range scale 1-5 (default: 3)"),
      count: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .describe("Number of results to return (default: 10)"),
    }),
    execute: async ({ lat, lng, range = 3, count = 10 }) => {
      ctx.usage.tool();
      return await ctx.clients.restaurant.searchRestaurants(
        lat,
        lng,
        range as 1 | 2 | 3 | 4 | 5,
        count,
      );
    },
  });
}
