"use client";

import { ArrowClockwise, FilePdf } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { markImagesEager, preparePrintAssets, toPrintDocumentTitle } from "@/lib/print";
import { cn } from "@/lib/utils";

export interface PrintButtonProps {
  targetRef?: React.RefObject<HTMLElement | null>;
  planTitle?: string | null;
}

type PrintState = "idle" | "preparing";

/** 印刷結果の注意書き。error は開始失敗、warn は開始はしたが品質が落ちる可能性。 */
type Notice = { kind: "error" | "warn"; message: string };

/** しおり本体のルート要素 id（`app/itinerary/page.tsx` 側と対応）。 */
const PRINT_ROOT_ID = "itinerary-print-root";

/** 注意書きを自動で消すまでの時間。押しっぱなしで残り続けないようにする。 */
const NOTICE_TIMEOUT_MS = 6000;

export function PrintButton({ targetRef, planTitle }: PrintButtonProps) {
  const [state, setState] = useState<PrintState>("idle");
  const [notice, setNotice] = useState<Notice | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalTitleRef = useRef<string | null>(null);
  const printTitleRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const resolvePrintRoot = useCallback(
    () => targetRef?.current ?? document.getElementById(PRINT_ROOT_ID) ?? document.body,
    [targetRef],
  );

  const showNotice = useCallback((next: Notice) => {
    if (!mountedRef.current) return;
    setNotice(next);
    if (noticeTimerRef.current !== null) {
      clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, NOTICE_TIMEOUT_MS);
  }, []);

  const applyPrintDocumentTitle = useCallback(() => {
    if (originalTitleRef.current === null) {
      originalTitleRef.current = document.title;
    }
    const printTitle = toPrintDocumentTitle(planTitle);
    printTitleRef.current = printTitle;
    document.title = printTitle;
  }, [planTitle]);

  const cleanupPrintState = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (
      originalTitleRef.current !== null &&
      printTitleRef.current !== null &&
      document.title === printTitleRef.current
    ) {
      document.title = originalTitleRef.current;
    }
    originalTitleRef.current = null;
    printTitleRef.current = null;
    if (mountedRef.current) {
      setState("idle");
    }
  }, []);

  // アンマウント後に印刷処理を続行せず、文書タイトルとタイマーを必ず元に戻す。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupPrintState();
      if (noticeTimerRef.current !== null) {
        clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
    };
  }, [cleanupPrintState]);

  /**
   * Cmd+P やブラウザメニューからの印刷はこのボタンを経由しないため、
   * `beforeprint` でも遅延画像の即時ロード化とファイル名の差し替えを行う。
   * `beforeprint` は await できないのでデコード完了までは待てず、
   * 完全な品質が欲しい場合はボタン経由（`handlePrint`）が必要。
   */
  useEffect(() => {
    const handleBeforePrint = () => {
      markImagesEager(resolvePrintRoot());
      // ボタン経由なら handlePrint が退避済み。二重退避で元タイトルを失わないよう守る。
      if (originalTitleRef.current === null) {
        applyPrintDocumentTitle();
      }
    };

    const handleAfterPrint = () => {
      cleanupPrintState();
    };

    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, [applyPrintDocumentTitle, cleanupPrintState, resolvePrintRoot]);

  const handlePrint = async () => {
    if (state === "preparing") return;

    setState("preparing");
    setNotice(null);

    try {
      const root = resolvePrintRoot();

      // 画像とフォントの準備待ち。落ちた分は印刷を止めず、劣化する旨だけ知らせる。
      const result = await preparePrintAssets(root);
      if (!mountedRef.current) return;

      if (result.failed > 0) {
        showNotice({
          kind: "warn",
          message: `画像${result.failed}枚を読み込めませんでした`,
        });
      } else if (!result.fontsReady) {
        showNotice({ kind: "warn", message: "フォントの準備が終わらないまま印刷します" });
      }

      // document.title を退避・設定
      applyPrintDocumentTitle();

      // afterprint が鳴らなかった場合のセーフティタイマー (12秒)
      fallbackTimerRef.current = setTimeout(() => {
        cleanupPrintState();
      }, 12000);

      // 印刷ダイアログを起動
      window.print();
    } catch (e) {
      if (!mountedRef.current) return;
      console.error("Print failed:", e);
      cleanupPrintState();
      showNotice({ kind: "error", message: "保存を開始できませんでした" });
    }
  };

  return (
    <div className="relative inline-flex items-center print:hidden">
      <button
        type="button"
        onClick={() => void handlePrint()}
        disabled={state === "preparing"}
        aria-busy={state === "preparing"}
        aria-label="しおりをPDFとして保存または印刷"
        title={
          state === "preparing"
            ? "印刷用に画像とフォントを準備しています…"
            : "しおりをPDFとして保存"
        }
        className="inline-flex items-center gap-1.5 rounded-full border-2 border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink shadow-toy transition-all hover:bg-surface-2 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-70 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {state === "preparing" ? (
          <ArrowClockwise size={16} className="animate-spin text-primary" />
        ) : (
          <FilePdf size={16} weight="bold" className="text-primary" />
        )}
        <span>{state === "preparing" ? "準備中…" : "PDF"}</span>
      </button>

      <span role="status" aria-live="polite" className="contents">
        {notice ? (
          <span
            className={cn(
              "absolute right-0 top-full z-30 mt-1 whitespace-nowrap rounded px-2 py-1 text-[10px] font-bold text-white shadow",
              notice.kind === "error" ? "bg-red-500" : "bg-amber-500",
            )}
          >
            {notice.message}
          </span>
        ) : null}
      </span>
    </div>
  );
}
