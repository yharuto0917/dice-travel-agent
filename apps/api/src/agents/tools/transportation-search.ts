import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";

export function buildTransportationSearch(ctx: ToolContext) {
  return tool({
    description: "Get directions and transit routes between two locations.",
    inputSchema: z.object({
      from: z
        .object({ lat: z.number(), lng: z.number() })
        .describe("Starting location coordinates"),
      to: z.object({ lat: z.number(), lng: z.number() }).describe("Destination coordinates"),
      fromName: z.string().describe("Name of the starting location"),
      toName: z.string().describe("Name of the destination"),
      mode: z
        .enum(["transit", "driving", "walking", "bicycling", "other"])
        .optional()
        .describe("Travel mode (default: transit)"),
    }),
    execute: async ({ from, to, fromName, toName, mode }) => {
      ctx.usage.tool();
      const mappedMode =
        mode === "transit"
          ? "transit"
          : mode === "driving"
            ? "car"
            : mode === "walking"
              ? "walk"
              : mode === "bicycling"
                ? "bicycle"
                : "other";
      return await ctx.clients.transit.getDirections(from, to, fromName, toName, mappedMode);
    },
  });
}
