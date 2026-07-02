import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";
import { GoogleGenAI } from "@google/genai";

export function buildGenerateImage(ctx: ToolContext) {
  return tool({
    description: "Generate an image for the travel plan. Call this exactly 2 times per day with a description of the location or scene.",
    inputSchema: z.object({
      prompt: z.string().describe("A brief description of the image to generate, e.g., 'Sunset at Kyoto temple'"),
    }),
    execute: async ({ prompt }) => {
      ctx.usage.generateImage();
      
      const { generateText } = await import("ai");
      const { createLlm } = await import("../llm/provider");
      
      // プロンプトジェネレーター（プロンプト生成）
      const expandedPromptRes = await generateText({
        model: createLlm(ctx.env, "gemini-3.5-flash"),
        system: "あなたはプロンプトエンジニアです。入力された簡単な旅行の風景や場所の説明から、高品質な写真画像を生成するための詳細なプロンプト（英語）を作成してください。",
        prompt: `次の内容を画像生成プロンプトに変換してください: ${prompt}`,
      });
      const generatedPrompt = expandedPromptRes.text;

      const ai = new GoogleGenAI({ apiKey: ctx.env.GEMINI_API_KEY });
      
      try {
        // We use gemini-3.1-flash-image to generate the image
        const res = await ai.models.generateContent({
          model: "gemini-3.1-flash-image",
          contents: generatedPrompt,
        });
        
        const part = res.candidates?.[0]?.content?.parts?.[0];
        if (!part?.inlineData) {
          return { error: "Failed to generate image. No image data returned." };
        }
        
        const { mimeType, data } = part.inlineData;
      const ext = mimeType.split("/")[1] || "jpeg";
      const key = `generated/${crypto.randomUUID()}.${ext}`;
      
      // Save to R2
      const { Buffer } = await import("node:buffer");
      const buffer = Buffer.from(data, "base64");
      await ctx.env.BUCKET.put(key, buffer, {
          httpMetadata: { contentType: mimeType },
        });
        
        // The URL will be served via our API route
        const url = `${ctx.env.WEB_ORIGIN || "http://localhost:8787"}/assets/${key}`;
        
        return { 
          success: true, 
          url,
          prompt,
          message: "Image generated and saved successfully."
        };
      } catch (error) {
        console.error("[generateImage] Error:", error);
        return { error: String(error) };
      }
    },
  });
}
