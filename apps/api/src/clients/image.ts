import { type ImageResult, ImageResultSchema } from "@repo/shared";
import { z } from "zod";
import { ApiClientBase } from "./base";

/**
 * 画像検索クライアント。
 * Unsplash API キーが設定されている場合は Unsplash API を、
 * 設定されていないが Pexels API キーが設定されている場合は Pexels API を使用します。
 * どちらも設定されていない場合は、検索をスキップして空配列を返します。
 */
export class ImageClient extends ApiClientBase {
  private unsplashAccessKey?: string;
  private pexelsApiKey?: string;

  constructor(config: { unsplashAccessKey?: string; pexelsApiKey?: string; kv?: KVNamespace }) {
    super(config.kv);
    this.unsplashAccessKey = config.unsplashAccessKey;
    this.pexelsApiKey = config.pexelsApiKey;
  }

  /**
   * クエリに一致する画像を検索します。
   */
  async searchImages(query: string, limit = 5): Promise<ImageResult[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const cacheKey = `api:image:${encodeURIComponent(trimmedQuery)}:${limit}`;

    return this.withCache(
      cacheKey,
      604800, // キャッシュTTL: 7日間 (604800秒)
      async () => {
        if (this.unsplashAccessKey) {
          try {
            return await this.searchWithUnsplash(trimmedQuery, limit);
          } catch (error) {
            console.error("[ImageClient] Unsplash API failed, falling back to Pexels:", error);
            if (this.pexelsApiKey) {
              try {
                return await this.searchWithPexels(trimmedQuery, limit);
              } catch (pexelsError) {
                console.error(
                  "[ImageClient] Pexels API failed after Unsplash fallback:",
                  pexelsError,
                );
              }
            }
          }
        } else if (this.pexelsApiKey) {
          try {
            return await this.searchWithPexels(trimmedQuery, limit);
          } catch (pexelsError) {
            console.error("[ImageClient] Pexels API failed:", pexelsError);
          }
        }
        console.warn("[ImageClient] No available API keys or both failed for image search.");
        return [];
      },
      z.array(ImageResultSchema),
    );
  }

  /**
   * Unsplash API を用いた画像検索
   */
  private async searchWithUnsplash(query: string, limit: number): Promise<ImageResult[]> {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
      query,
    )}&per_page=${limit}&orientation=landscape`;

    const response = await this.fetchWithRetry(url, {
      method: "GET",
      headers: {
        Authorization: `Client-ID ${this.unsplashAccessKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Unsplash API returned status ${response.status}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: response structure is dynamic
    const data = (await response.json()) as any;
    if (!data.results || !Array.isArray(data.results)) {
      return [];
    }

    // biome-ignore lint/suspicious/noExplicitAny: photo structure is dynamic
    return data.results.map((photo: any): ImageResult => {
      return {
        url: photo.urls?.regular || photo.urls?.full || "",
        thumbUrl: photo.urls?.small || photo.urls?.thumb || undefined,
        alt: photo.description || photo.alt_description || undefined,
        author: photo.user?.name || "Unsplash Author",
        authorUrl: photo.user?.links?.html || undefined,
        source: "unsplash",
      };
    });
  }

  /**
   * Pexels API を用いた画像検索
   */
  private async searchWithPexels(query: string, limit: number): Promise<ImageResult[]> {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(
      query,
    )}&per_page=${limit}&orientation=landscape`;

    const response = await this.fetchWithRetry(url, {
      method: "GET",
      headers: {
        Authorization: this.pexelsApiKey || "",
      },
    });

    if (!response.ok) {
      throw new Error(`Pexels API returned status ${response.status}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: response structure is dynamic
    const data = (await response.json()) as any;
    if (!data.photos || !Array.isArray(data.photos)) {
      return [];
    }

    // biome-ignore lint/suspicious/noExplicitAny: photo structure is dynamic
    return data.photos.map((photo: any): ImageResult => {
      return {
        url: photo.src?.large || photo.src?.original || "",
        thumbUrl: photo.src?.medium || photo.src?.small || undefined,
        alt: photo.alt || undefined,
        author: photo.photographer || "Pexels Photographer",
        authorUrl: photo.photographer_url || undefined,
        source: "pexels",
      };
    });
  }
}
