export type PreparePrintResult = {
  total: number;
  failed: number;
  fontsReady: boolean;
};

/**
 * PDFのファイル名制御用に document.title に設定する文字列を生成する。
 * Windows/macOS 等でファイル名に使えない禁止文字 (/ \ : * ? " < > |) と改行を除去する。
 */
export function toPrintDocumentTitle(planTitle: string | null | undefined): string {
  const trimmed = planTitle?.trim();
  if (!trimmed) {
    return "旅のしおり";
  }

  // ファイル名に使えない危険な文字と改行を除去
  const sanitized = trimmed.replace(/[/\\:*?"<>|\r\n]/g, "").trim();

  if (!sanitized) {
    return "旅のしおり";
  }

  return `旅のしおり_${sanitized}`;
}

/**
 * 指定要素配下の <img> を印刷用に即時ロード・同期デコードへ切り替える。
 *
 * beforeprint（Cmd+P やブラウザメニュー経由の印刷）は await できないため、
 * 「同期的にできる分だけ」を切り出した関数として公開している。
 */
export function markImagesEager(root: HTMLElement): HTMLImageElement[] {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  for (const img of images) {
    img.loading = "eager";
    img.decoding = "sync";
  }
  return images;
}

/**
 * 指定要素配下の <img> の loading="lazy" を解除し、デコード完了を待つ。
 * あわせて document.fonts.ready も待つ。
 * 画像の失敗やタイムアウトがあっても例外を投げず集計結果を返す。
 */
export async function preparePrintAssets(
  root: HTMLElement,
  options?: { timeoutMs?: number },
): Promise<PreparePrintResult> {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const images = markImagesEager(root);
  const total = images.length;

  // 画像デコードの待機処理
  const imagePromises = images.map(async (img): Promise<boolean> => {
    // すでに完了していて正常画像の場合
    if (img.complete && img.naturalWidth > 0) {
      return true;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), timeoutMs);
    });

    const decodePromise = (async (): Promise<boolean> => {
      try {
        if (typeof img.decode === "function") {
          await img.decode();
          return true;
        }
      } catch {
        // decode() が失敗した場合は onload/onerror でフォールバック待機
      }

      if (img.complete) {
        return img.naturalWidth > 0;
      }

      return new Promise<boolean>((resolve) => {
        const onLoad = () => {
          cleanup();
          resolve(true);
        };
        const onError = () => {
          cleanup();
          resolve(false);
        };
        const cleanup = () => {
          img.removeEventListener("load", onLoad);
          img.removeEventListener("error", onError);
        };

        img.addEventListener("load", onLoad);
        img.addEventListener("error", onError);
      });
    })();

    try {
      const result = await Promise.race([decodePromise, timeoutPromise]);
      return result;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  });

  // フォント準備の待機処理
  const fontsPromise = (async (): Promise<boolean> => {
    if (typeof document === "undefined" || !document.fonts?.ready) {
      return false;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), timeoutMs);
    });

    const readyPromise = document.fonts.ready.then(() => true).catch(() => false);

    try {
      return await Promise.race([readyPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  })();

  const [imageResults, fontsReady] = await Promise.all([Promise.all(imagePromises), fontsPromise]);

  const failed = imageResults.filter((success) => !success).length;

  return {
    total,
    failed,
    fontsReady,
  };
}
