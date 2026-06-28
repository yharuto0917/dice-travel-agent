import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { google } from "@ai-sdk/google";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { Bindings } from "../../env";
import { SUBAGENT_MAX_STEPS } from "../flow/judgement";
import { createLlm, SUBAGENT_MODEL_ID } from "../llm/provider";
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
        model: createLlm(env, SUBAGENT_MODEL_ID),
        system:
          "You are a research subagent for a travel planning system. Use the provided tools to gather information, then output a concise summary of concrete, real, currently-operating candidate locations (実在し現在も営業/公開している場所のみ). For each candidate, give its name, area, and a one-line reason it fits the topic. Do not invent places or include ones whose existence is uncertain. Be efficient: avoid redundant searches. 思考（reasoning）と最終的なまとめは、すべて日本語で記述してください。",
        prompt: `Topic: ${topic}\nAround: ${around || "Not specified"}`,
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingLevel: "high",
              includeThoughts: true,
            },
          } satisfies GoogleGenerativeAIProviderOptions,
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
