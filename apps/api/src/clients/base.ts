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
    // 1. キャッシュ読み込み。読み込み・JSON解析・スキーマ検証のいずれかに失敗しても、
    //    新規取得へフォールバックできるよう全体を try/catch で囲む。
    if (this.kv) {
      try {
        const cached = await this.kv.get(key);
        if (cached !== null) {
          const parsed = JSON.parse(cached);
          return schema ? schema.parse(parsed) : (parsed as T);
        }
      } catch (error) {
        console.error(`[ApiClientBase] Cache read error for key "${key}":`, error);
        // 読み込み・検証に失敗した場合は、そのまま新規取得にフォールバックする
      }
    }

    // 2. 新規取得し、キャッシュへ保存する前にスキーマ検証する。
    //    これにより初回取得時もDTOへの正規化を保証し、不正なデータをキャッシュに残さない。
    const fetched = await fetchFn();
    const result: T = schema ? schema.parse(fetched) : fetched;

    // 3. 検証済みのデータのみキャッシュへ保存する。
    if (this.kv) {
      try {
        // Cloudflare KV の仕様上、expirationTtl は最低60秒である必要があります
        const actualTtl = Math.max(60, ttlSeconds);
        await this.kv.put(key, JSON.stringify(result), {
          expirationTtl: actualTtl,
        });
      } catch (error) {
        console.error(`[ApiClientBase] Cache write error for key "${key}":`, error);
      }
    }

    return result;
  }
}
