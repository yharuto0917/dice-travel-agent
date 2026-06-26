import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";

export function buildImageSearch(ctx: ToolContext) {
  return tool({
    description: "Search for images related to a query.",
    inputSchema: z.object({
      query: z.string().describe("Search query for the image"),
      limit: z.number().optional().describe("Number of images to return (default: 5)"),
    }),
    execute: async ({ query, limit = 5 }) => {
      ctx.usage.tool();
      return await ctx.clients.image.searchImages(query, limit);
    },
  });
}
