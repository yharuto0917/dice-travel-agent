"use client";

import { MapTrifold, Shuffle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { JapanMap3D } from "@/components/map/JapanMap3D";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { generateDestinationCandidates } from "@/lib/destinations";
import { FLOW_STEPS } from "@/lib/flow";
import { useDiceStore } from "@/lib/stores/diceStore";
import { cn } from "@/lib/utils";

export default function DestinationPage() {
  const router = useRouter();
  const { candidates, setCandidates } = useDiceStore();

  const [regions, setRegions] = useState<string[]>([]);
  const [areaTypes, setAreaTypes] = useState<string[]>([]);

  const REGIONS = ["北海道", "東北", "関東", "中部", "関西", "中国", "四国", "九州・沖縄"];
  const AREAS = [
    { value: "urban", label: "都市圏" },
    { value: "suburb", label: "郊外・自然" },
  ];

  const toggleRegion = (r: string) =>
    setRegions((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  const toggleArea = (a: string) =>
    setAreaTypes((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  // 初回マウント時に候補を生成
  // biome-ignore lint/correctness/useExhaustiveDependencies: run only on mount
  useEffect(() => {
    if (candidates.length === 0) {
      setCandidates(generateDestinationCandidates(undefined, { regions, areaTypes }));
    }
  }, []);

  const handleShuffle = () => {
    setCandidates(generateDestinationCandidates(undefined, { regions, areaTypes }));
  };

  const handleProceed = () => {
    router.push("/dice");
  };

  const mapCandidates = candidates.map((c, idx) => ({
    prefectureId: parseInt(c.prefectureCode, 10),
    prefectureName: c.prefecture,
    color: ["#7cc1d6", "#f0b86e", "#d98ca0", "#a99cd6", "#8fbf9f", "#f2c75a"][idx % 6],
    label: `候補 ${idx + 1}`,
  }));

  return (
    <AppShell title="行き先候補" back={{ href: "/" }}>
      <div className="flex flex-1 flex-col pb-6 relative">
        <ol className="flex items-center gap-1.5 z-10">
          {FLOW_STEPS.map((s, i) => (
            <li
              key={s.slug}
              className={cn("h-1.5 flex-1 rounded-full", i <= 0 ? "bg-primary" : "bg-surface-2")}
            />
          ))}
        </ol>
        <p className="mt-3 text-xs font-bold tracking-wide text-muted z-10">
          STEP 01 / {String(FLOW_STEPS.length).padStart(2, "0")}
        </p>

        <h1 className="mt-3 text-xl font-extrabold tracking-tight z-10">
          行き先候補をピックアップ
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted z-10">
          全国からランダムに6つの候補を選びました。条件を複数選んでシャッフルできます。
        </p>

        <div className="mt-4 flex flex-col gap-4 z-10">
          <div>
            <div className="block text-xs font-bold text-muted mb-2">地域（複数選択可）</div>
            <div className="flex flex-wrap gap-2">
              {REGIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleRegion(r)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-bold rounded-full border transition-colors",
                    regions.includes(r)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-surface-2 text-foreground border-transparent",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="block text-xs font-bold text-muted mb-2">エリア特徴（複数選択可）</div>
            <div className="flex flex-wrap gap-2">
              {AREAS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => toggleArea(a.value)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-bold rounded-full border transition-colors",
                    areaTypes.includes(a.value)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-surface-2 text-foreground border-transparent",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Button variant="outline" className="mt-3 w-full z-10" onClick={handleShuffle}>
          <Shuffle size={18} weight="bold" />
          この条件でシャッフル
        </Button>

        <Card className="mt-4 overflow-hidden p-0 relative z-10">
          <div className="aspect-[4/3] min-h-[360px] w-full">
            <JapanMap3D candidates={mapCandidates} selectedPrefectureId={null} />
          </div>
        </Card>

        <div className="mt-4 flex flex-col gap-2 z-10">
          <h2 className="text-sm font-bold text-muted">候補地リスト</h2>
          <div className="grid grid-cols-2 gap-2">
            {candidates.map((c, idx) => (
              <div
                key={c.id}
                className="flex items-center gap-2 p-3 rounded-xl border bg-surface-2 text-sm font-bold"
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white"
                  style={{ backgroundColor: mapCandidates[idx].color }}
                >
                  {idx + 1}
                </div>
                {c.prefecture}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-auto pt-6 flex flex-col items-center gap-2 z-10">
          <Button className="w-full py-6 text-lg font-bold rounded-2xl" onClick={handleProceed}>
            <MapTrifold size={24} weight="fill" className="mr-2" />
            サイコロで決める
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
