"use client";

import { CheckCircle, HandPointing, Shuffle } from "@phosphor-icons/react";
import { MAX_REROLLS } from "@repo/shared";
import { useMutation } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { GameState } from "@/components/dice/DiceScene";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { FLOW_STEPS } from "@/lib/flow";
import { useDiceStore } from "@/lib/stores/diceStore";
import { cn } from "@/lib/utils";

const DiceScene = dynamic(
  () => import("@/components/dice/DiceScene").then((mod) => mod.DiceScene),
  { ssr: false },
);

export default function DicePage() {
  const router = useRouter();
  const { candidates, rolledFace, rerollCount, canReroll, confirmDestination, confirmed } =
    useDiceStore();

  const [gameState, setGameState] = useState<GameState>("idle");
  const [triggerCount, setTriggerCount] = useState(0);

  // 候補がない場合はdestinationに戻す
  useEffect(() => {
    if (candidates.length === 0) {
      router.replace("/destination");
    }
  }, [candidates.length, router]);

  const handleRoll = () => {
    if (gameState === "rolling") return;
    if (rolledFace !== null && !canReroll()) return;
    setGameState("rolling");
    setTriggerCount((c) => c + 1);
  };

  const saveDestinationMutation = useMutation({
    mutationFn: async (_candidateId: string) => {
      // TODO: 実際のAPIエンドポイントに置き換える
      return new Promise((resolve) => setTimeout(() => resolve({ success: true }), 500));
    },
    onSuccess: () => {
      // 次のステップ（旅の条件）へ遷移
      router.push("/conditions");
    },
  });

  const handleConfirm = () => {
    confirmDestination();
    if (rolledFace === null) return;
    const selectedId = candidates[rolledFace - 1]?.id;
    if (selectedId) {
      saveDestinationMutation.mutate(selectedId);
    }
  };

  const touchStartY = useRef(0);
  const touchTime = useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    touchStartY.current = e.clientY;
    touchTime.current = Date.now();
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const dy = e.clientY - touchStartY.current;
    const dt = Date.now() - touchTime.current;
    if (dy < -30 || dt < 300) {
      handleRoll();
    }
  };

  if (candidates.length === 0) return null;

  const currentDestination = rolledFace ? candidates[rolledFace - 1] : null;

  return (
    <AppShell title="サイコロ" back={{ href: "/destination" }}>
      <div className="flex flex-1 flex-col pb-6 relative">
        <ol className="flex items-center gap-1.5 z-10">
          {FLOW_STEPS.map((s, i) => (
            <li
              key={s.slug}
              className={cn("h-1.5 flex-1 rounded-full", i <= 1 ? "bg-primary" : "bg-surface-2")}
            />
          ))}
        </ol>
        <p className="mt-3 text-xs font-bold tracking-wide text-muted z-10">
          STEP 02 / {String(FLOW_STEPS.length).padStart(2, "0")}
        </p>

        <h1 className="mt-3 text-xl font-extrabold tracking-tight z-10">サイコロで行き先を決定</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted z-10">
          出た目の番号の目的地に決定します。スワイプしてサイコロを振ってください。
        </p>

        {/* 候補リスト */}
        <div className="mt-4 grid grid-cols-2 gap-2 z-10">
          {candidates.map((c, i) => (
            <div
              key={c.id}
              className={cn(
                "flex items-center gap-2 p-3 rounded-xl border text-sm font-bold transition-colors",
                rolledFace === i + 1
                  ? "bg-primary/10 border-primary text-primary"
                  : "bg-surface-2 border-transparent text-foreground",
              )}
            >
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-xs text-white",
                  rolledFace === i + 1 ? "bg-primary" : "bg-muted-foreground/50",
                )}
              >
                {i + 1}
              </div>
              {c.prefecture}
            </div>
          ))}
        </div>

        {/* 決定の表示 */}
        <div className="mt-4 min-h-[3rem] flex items-center justify-center z-10">
          {gameState === "finished" && currentDestination && (
            <div className="bg-primary/10 text-primary px-6 py-2 rounded-full font-black text-lg animate-in fade-in zoom-in duration-300">
              行き先は【{currentDestination.prefecture}】に決定！
            </div>
          )}
        </div>

        {/* サイコロシーン */}
        <div
          className="relative h-[250px] w-full mt-2 rounded-3xl overflow-hidden bg-surface-2 touch-none z-10 shadow-inner"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          <DiceScene
            gameState={gameState}
            setGameState={setGameState}
            triggerRollCount={triggerCount}
          />

          {gameState === "idle" && rolledFace === null && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-black/60 backdrop-blur-sm px-6 py-3 rounded-full flex items-center gap-2 text-white animate-bounce">
                <HandPointing size={20} weight="fill" />
                <span className="text-sm font-bold">スワイプ or タップして振る</span>
              </div>
            </div>
          )}
        </div>

        {/* 振り直しステータス */}
        {rolledFace !== null && (
          <div className="mt-4 flex flex-col items-center gap-2 z-10">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold">振り直し残り:</span>
              <span
                className={cn(
                  "text-lg font-black tabular-nums",
                  canReroll() ? "text-primary" : "text-destructive",
                )}
              >
                {MAX_REROLLS - rerollCount} / {MAX_REROLLS}
              </span>
            </div>

            <div className="flex w-full gap-3 mt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleRoll}
                disabled={!canReroll() || gameState === "rolling" || confirmed}
              >
                <Shuffle size={18} weight="bold" />
                もう一度振る
              </Button>
              <Button
                className="flex-1"
                onClick={handleConfirm}
                disabled={gameState === "rolling" || confirmed || saveDestinationMutation.isPending}
              >
                <CheckCircle size={18} weight="bold" />
                ここに決定
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
