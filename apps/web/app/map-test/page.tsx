"use client";

import { MapPinLine, X } from "@phosphor-icons/react";
import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { JapanMap3D, type MapCandidate } from "@/components/map/JapanMap3D";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// マットなパステルで6候補を塗り分け（ミニチュア・ジオラマの配色に合わせる）
const SAMPLE_CANDIDATES: MapCandidate[] = [
  { prefectureId: 1, prefectureName: "北海道", color: "#7cc1d6", label: "候補 1" },
  { prefectureId: 13, prefectureName: "東京都", color: "#f0b86e", label: "候補 2" },
  { prefectureId: 26, prefectureName: "京都府", color: "#d98ca0", label: "候補 3" },
  { prefectureId: 27, prefectureName: "大阪府", color: "#a99cd6", label: "候補 4" },
  { prefectureId: 40, prefectureName: "福岡県", color: "#8fbf9f", label: "候補 5" },
  { prefectureId: 47, prefectureName: "沖縄県", color: "#f2c75a", label: "候補 6" },
];

export default function MapTestPage() {
  const [selectedPref, setSelectedPref] = useState<{ id: number; name: string } | null>(null);

  const handleSelectPref = (id: number, name: string) => {
    setSelectedPref({ id, name });
  };

  return (
    <AppShell title="3D地図プレビュー" back={{ href: "/" }}>
      <p className="inline-flex items-center gap-1.5 rounded-full border-2 border-line bg-surface px-3 py-1 text-xs font-bold text-muted shadow-toy">
        <MapPinLine size={14} weight="bold" />
        ミニチュア日本地図
      </p>

      <p className="mt-3 text-sm leading-relaxed text-muted">
        Three.js (React Three Fiber)
        で描くミニチュア風の日本地図デモ。候補地はピンで示され、地図をクリック／タップで選べます。
      </p>

      {/* 地図の描画エリア */}
      <Card className="mt-5 overflow-hidden p-0">
        <div className="aspect-[4/3] min-h-[380px] w-full">
          <JapanMap3D
            candidates={SAMPLE_CANDIDATES}
            selectedPrefectureId={selectedPref?.id}
            onSelectPrefecture={handleSelectPref}
          />
        </div>
      </Card>

      {/* 選択中の都道府県 */}
      <section className="mt-6">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
          選択中の都道府県
        </h2>
        <Card>
          <CardBody className="p-4">
            {selectedPref ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xl font-extrabold tracking-tight">{selectedPref.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">ID: {selectedPref.id}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setSelectedPref(null)}
                >
                  <X size={16} weight="bold" />
                  解除
                </Button>
              </div>
            ) : (
              <p className="rounded-2xl border-2 border-dashed border-line/40 px-4 py-6 text-center text-xs text-muted">
                地図上の都道府県をクリック／タップしてください。
              </p>
            )}
          </CardBody>
        </Card>
      </section>

      {/* 候補地リスト */}
      <section className="mt-6">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
          候補地リスト（6箇所）
        </h2>
        <div className="grid gap-2">
          {SAMPLE_CANDIDATES.map((candidate) => {
            const isSelected = selectedPref?.id === candidate.prefectureId;
            return (
              <button
                type="button"
                key={candidate.prefectureId}
                onClick={() => handleSelectPref(candidate.prefectureId, candidate.prefectureName)}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border-2 border-line px-3 py-2.5 text-left shadow-toy transition-all",
                  "active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
                  isSelected ? "bg-foreground text-background" : "bg-surface hover:bg-surface-2",
                )}
              >
                <span
                  className="h-4 w-4 shrink-0 rounded-full border-2 border-line"
                  style={{ backgroundColor: candidate.color }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-bold opacity-70">{candidate.label}</span>
                  <span className="block text-sm font-bold">{candidate.prefectureName}</span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full border-2 border-line px-2 py-0.5 font-mono text-[10px]",
                    isSelected ? "bg-background text-foreground" : "bg-surface-2 text-muted",
                  )}
                >
                  ID {candidate.prefectureId}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}
