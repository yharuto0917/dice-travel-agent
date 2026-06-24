/**
 * 外部APIクライアントの共通ベースクラス。
 * タイムアウト、指数バックオフによるリトライ、Cloudflare KVによるキャッシュ処理を提供します。
 */
export class ApiClientBase {
  protected kv?: KVNamespace;

  constructor(kv?: KVNamespace) {
    this.kv = kv;
  }

  /**
   * タイムアウト付きのフェッチを実行します。
   */
  protected async fetchWithTimeout(
    url: string,
    init?: RequestInit,
    timeoutMs = 5000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 指数バックオフによるリトライ付きフェッチを実行します。
   * 5xxエラー、またはネットワークエラーのときのみリトライします。
   */
  protected async fetchWithRetry(
    url: string,
    init?: RequestInit,
    maxRetries = 3,
    timeoutMs = 5000,
  ): Promise<Response> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, init, timeoutMs);
        if (response.ok || response.status < 500) {
          return response;
        }
        lastError = new Error(`HTTP error! status: ${response.status} url: ${url}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
      if (attempt < maxRetries - 1) {
        // 指数バックオフ (200ms, 400ms, 800ms...)
        const delay = 2 ** attempt * 200;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError || new Error(`Fetch failed for ${url}`);
  }

  /**
   * KVキャッシュを用いてデータを取得します。
   * キャッシュが存在しない場合は、fetchFnを実行してキャッシュに格納します。
   */
  protected async withCache<T>(
    key: string,
    ttlSeconds: number,
    fetchFn: () => Promise<T>,
    // biome-ignore lint/suspicious/noExplicitAny: schema parser is dynamic across workspace
    schema?: any,
  ): Promise<T> {
    if (!this.kv) {
      return fetchFn();
    }

    try {
      const cached = await this.kv.get(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (schema) {
          return schema.parse(parsed);
        }
        return parsed as T;
      }
    } catch (error) {
      console.error(`[ApiClientBase] Cache read error for key "${key}":`, error);
      // キャッシュ読み込みで失敗した場合は、フォールバックしてそのままフェッチする
    }

    const result = await fetchFn();

    try {
      // Cloudflare KV の仕様上、expirationTtl は最低60秒である必要があります
      const actualTtl = Math.max(60, ttlSeconds);
      await this.kv.put(key, JSON.stringify(result), {
        expirationTtl: actualTtl,
      });
    } catch (error) {
      console.error(`[ApiClientBase] Cache write error for key "${key}":`, error);
    }

    return result;
  }
}
