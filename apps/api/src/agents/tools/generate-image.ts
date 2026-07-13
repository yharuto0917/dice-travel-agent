import type {
  GoogleGenerativeAIImageProviderOptions,
  GoogleGenerativeAIProviderOptions,
} from "@ai-sdk/google";
import { google } from "@ai-sdk/google";
import { generateImage, generateText, stepCountIs } from "ai";
import type { Bindings } from "../../env";
import { createImageModel, createLlm } from "../llm/provider";
import type { GeneratedImage } from "./context";

/** 画像生成モデル（#18）。 */
const PROMPT_GENERATE_MODEL_ID = "gemini-3.5-flash";
const IMAGE_MODEL_ID = "gemini-3.1-flash-image";

/**
 * 主題（アイテム名・場所名など）から1枚の画像を生成して R2 に保存し、配信URLを返す（#18）。
 *
 * 旅程アイテムごとに内容一致の画像を作るため、runDay の構造化後パスから**並列に**呼ぶ。
 * かつては LLM が `generateImage` ツールを呼ぶ設計だったが、
 * - ステップ上限と競合して各日2回すら呼べないことがある
 * - 返る URL（ランダム UUID）を LLM が各アイテムへ正確に転記できない
 * - 生成物が「シーン」指定で、貼り付け先アイテムと内容が一致しない
 * という問題があったため、コード側から決定的に生成・添付する方式へ移行した。
 *
 * 認証鍵（GEMINI_API_KEY）未設定時や生成失敗時は null を返し、呼び出し側は画像なしで続行する。
 */
export async function generateItemImage(
  env: Bindings,
  subject: string,
): Promise<GeneratedImage | null> {
  if (!env.GEMINI_API_KEY) return null;

  // 主題（場所名など）を、写真向けの詳細な英語プロンプトへ拡張する。
  // 拡張自体が失敗した場合は握り潰さず、そのまま Error を呼び出し側へ伝播させる。
  const { text } = await generateText({
    model: createLlm(env, PROMPT_GENERATE_MODEL_ID),
    system:
      "あなたは画像生成プロンプトの専門家です。旅行先の場所・風景から、写実的で高品質な1枚の写真を生成するための詳細な英語プロンプトのみを出力してください。",
    prompt: `ユーザーから${subject}に関する画像を生成する指示です。\n
            以下の【テンプレート】と【生成ルール】に従って、高品質な英語の画像生成プロンプトを作成し、出力してください。\n
            【テンプレート】\n
            Present a clear, 45° top-down isometric miniature 3D cartoon scene built on a perfect square base, featuring [
            （ここに生成した詳細なシーン描写を挿入）\n
            ]. Use soft, refined textures with realistic PBR materials and gentle, lifelike lighting and shadows. Use a clean, minimalistic composition with a muted, solid-colored background. No sky, no clouds, and no external environment beyond the square miniature base.\n
            【生成ルール】\n
            カッコ "[ ]" の中に挿入する「詳細なシーン描写」は、以下の要素を含めて必ず**英語**で作成してください。\n
            1. **主題と視点**: "A majestic high-angle bird's-eye view of [観光地名]..." で始め、その観光地を象徴するランドマーク、建造物、自然地形などを**四角形のミニチュアベース（square-shaped miniature base）**内にすっきりと収まるように配置して描写してください。\n
            2. **周囲の情景**: 観光地の周辺環境（例: 豊かな森、美しい海、伝統的な街並み、雄大な山肌など）を、四角いベースの境界線（edges）を活かして立体的に描写してください。\n
            3. **時間帯とライティング**: その観光地が美しく見える時間帯（夕暮れの暖かな光、夜明けの幻想的な光など）の「光の当たり方」を設定し、光と影のコントラストやシネマティックな照明（Cinematic lighting）を描写してください。\n
            **※重要：背景は落ち着いた単色とするため、空、雲、太陽、星などの背景要素（sky, clouds, stars など）は絶対に描写しないでください。**\n
            4. **品質指定**: 描写の末尾に、必ず以下の最高品質を示すカメラ・解像度タグを含めてください。また、Google検索などを駆使し、より現実の情報を取り入れるようにしてください。 "Captured with a wide-angle lens, showcasing extreme detail, sharp focus, 8k resolution, photorealistic architectural/landscape photography.\n
            5. **出力形式**: 挨拶や解説は一切含めず、完成した英語のプロンプトのみを出力してください。\n
            【入力と出力の例】\n
            ユーザー入力: 富士山と河口湖\n
            出力:\n 
            Present a clear, 45° top-down isometric miniature 3D cartoon scene built on a perfect square base, featuring [A majestic high-angle bird's-eye view of Mount Fuji and Lake Kawaguchi at dawn, beautifully contained within a square-shaped miniature base. The iconic snow-capped peak takes center stage, brilliantly illuminated in a warm, glowing pink and golden light, showcasing its elegant symmetrical slopes. In the bottom foreground, a serene blue lake beautifully reflects the mountain, surrounded by lush green forests and vibrant pink cherry blossoms extending right to the crisp square edges. Cinematic lighting, with a striking contrast between the cool morning ambient shadows and the warm golden hour illumination. Captured with a wide-angle lens, showcasing extreme detail, sharp focus, 8k resolution, photorealistic landscape photography.]. Use soft, refined textures with realistic PBR materials and gentle, lifelike lighting and shadows. Use a clean, minimalistic composition with a muted, solid-colored background. No sky, no clouds, and no external environment beyond the square miniature base.\n`,
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: "high" },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    tools: {
      google_search: google.tools.googleSearch({}),
    },
    stopWhen: stepCountIs(3),
  });

  // 空応答は拡張失敗とみなし、Error を送出する。
  const imagePrompt = text.trim();
  if (!imagePrompt) {
    throw new Error(`[generateItemImage] プロンプト生成に失敗しました: ${subject}`);
  }

  try {
    const result = await generateImage({
      model: createImageModel(env, IMAGE_MODEL_ID),
      prompt: `Please generate image using below prompt.\n
               ATTENTION:\n
               YOU HAVE TO USE IMAGE AND TEXT SEARCH BEFORE GENERATE IMAGE TO KNOW WHAT YOU WILL GENETATE.\n
               Prompt:\n
               ${imagePrompt}`,
      providerOptions: {
        google: {
          googleSearch: { searchTypes: { imageSearch: {}, webSearch: {} } },
          aspectRatio: "1:1",
        } satisfies GoogleGenerativeAIImageProviderOptions,
      },
    });
    const image = result.image;
    if (!image) return null;
    const mimeType = "image/png";
    const ext = "png";
    const key = `generated/${crypto.randomUUID()}.${ext}`;
    await env.BUCKET.put(key, image.uint8Array, {
      httpMetadata: { contentType: mimeType },
    });

    // アセットは API ワーカーの /assets ルートが配信する。フロント（WEB_ORIGIN）ではなく
    // API 自身の公開オリジン（ASSET_BASE_URL）で URL を組み立てる。未設定時はローカル既定。
    const base = env.ASSET_BASE_URL || "http://localhost:8787";
    return { url: `${base}/assets/${key}`, prompt: subject };
  } catch (error) {
    console.error("[generateItemImage] Error:", error);
    return null;
  }
}
