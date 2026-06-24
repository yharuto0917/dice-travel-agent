import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";

export function buildCalculate(ctx: ToolContext) {
  return tool({
    description: "Perform calculations like sum, budget split, or distance.",
    inputSchema: z.object({
      op: z.enum(["sum", "budgetSplit", "distanceKm"]).describe("Operation to perform"),
      values: z.array(z.number()).describe("Array of numeric values to use in calculation"),
    }),
    execute: async ({ op, values }) => {
      ctx.usage.tool();
      switch (op) {
        case "sum":
          return { result: values.reduce((a, b) => a + (b || 0), 0) };
        case "budgetSplit":
          // values[0] is total budget, values[1] is number of days/people
          if (values.length < 2 || !values[1])
            return { error: "budgetSplit requires total and divisor (not zero)" };
          return { result: (values[0] || 0) / values[1] };
        case "distanceKm": {
          // Not mathematically precise, just an approximation if needed, or error out
          if (
            values.length < 4 ||
            values[0] == null ||
            values[1] == null ||
            values[2] == null ||
            values[3] == null
          ) {
            return { error: "distanceKm requires lat1, lng1, lat2, lng2" };
          }
          const lat1 = values[0],
            lng1 = values[1],
            lat2 = values[2],
            lng2 = values[3];
          const R = 6371; // Earth's radius in km
          const dLat = ((lat2 - lat1) * Math.PI) / 180;
          const dLng = ((lng2 - lng1) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
              Math.cos((lat2 * Math.PI) / 180) *
              Math.sin(dLng / 2) *
              Math.sin(dLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return { result: R * c };
        }
        default:
          return { error: "Unknown operation" };
      }
    },
  });
}
