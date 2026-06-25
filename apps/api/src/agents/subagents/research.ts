import { generateText, stepCountIs, tool } from "ai";
import { google, GoogleEmbeddingModelOptions } from "@ai-sdk/google";
import { z } from "zod";
import type { Bindings } from "../../env";
import { SUBAGENT_MAX_STEPS } from "../flow/judgement";
import { createLlm } from "../llm/provider";
import type { ToolContext } from "../tools/context";
import { buildGoogleMaps } from "../tools/google-maps";
import { buildRestaurantSearch } from "../tools/restaurant-search";
import { buildTouristSpotSearch } from "../tools/tourist-spot-search";
import { buildWeatherSearch } from "../tools/weather-search";

export function buildResearchSubagent(env: Bindings, ctx: ToolContext) {
  return tool({
    description: "Research destinations, themes, sightseeing spots, and seasonal info.",
    inputSchema: z.object({
      topic: z.string().describe("Research topic or destination"),
      around: z.string().optional().describe("General area to focus on"),
    }),
    execute: async ({ topic, around }) => {
      ctx.usage.subagent();

      const { text } = await generateText({
        model: createLlm(env),
        system:
          "You are a research subagent for a travel planning system. Gather information using the provided tools and output a clear summary of your findings and candidate locations.",
        prompt: `Topic: ${topic}\nAround: ${around || "Not specified"}`,
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingLevel: "high",
              includeThoughts: true,
            },
          },
        },
        tools: {
          google_search: google.tools.googleSearch({}),
          touristSpotSearch: buildTouristSpotSearch(ctx),
          restaurantSearch: buildRestaurantSearch(ctx),
          weather: buildWeatherSearch(ctx),
          googleMaps: buildGoogleMaps(ctx),
        },
        stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
      });

      return { findings: text };
    },
  });
}
