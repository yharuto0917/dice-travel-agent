import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";

export function buildGoogleMaps(ctx: ToolContext) {
  return tool({
    description: "Geocode a search query or address into latitude and longitude coordinates.",
    inputSchema: z.object({
      query: z.string().describe("Location name or address to geocode"),
    }),
    execute: async ({ query }) => {
      ctx.usage.tool();
      return await ctx.clients.geocoding.geocode(query);
    },
  });
}
