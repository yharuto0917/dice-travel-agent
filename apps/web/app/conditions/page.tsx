"use client";

import { Minus, Plus, SlidersHorizontal } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { createPlan } from "@/lib/api";
import { FLOW_STEPS } from "@/lib/flow";
import { useDiceStore } from "@/lib/stores/diceStore";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = ["温泉", "グルメ", "自然", "絶景", "歴史・文化", "アクティビティ"];
const TRANSPORT_OPTIONS = ["公共交通機関", "レンタカー", "新幹線", "飛行機", "徒歩多め"];

export default function ConditionsPage() {
  const router = useRouter();
  const { candidates, confirmedCandidateId } = useDiceStore();

  const [themes, setThemes] = useState<string[]>([]);
  const [customTheme, setCustomTheme] = useState("");
  const [budgetRange, setBudgetRange] = useState<[number, number]>([0, 50000]);
  const [nights, setNights] = useState(1);
  const [partySize, setPartySize] = useState(1);
  const [transports, setTransports] = useState<string[]>([]);
  const [customTransport, setCustomTransport] = useState("");
  const [customRequests, setCustomRequests] = useState("");

  const destination = candidates.find((c) => c.id === confirmedCandidateId);

  useEffect(() => {
    if (!destination) {
      router.replace("/destination");
    }
  }, [destination, router]);

  const createPlanMutation = useMutation({
    mutationFn: async () => {
      if (!destination) throw new Error("Destination is not set");
      const allThemes = customTheme.trim() ? [...themes, customTheme.trim()] : themes;
      const allTransports = customTransport.trim()
        ? [...transports, customTransport.trim()]
        : transports;

      return createPlan({
        destinationPrefCode: destination.prefectureCode,
        destinationPref: destination.prefecture,
        conditions: {
          themes: allThemes,
          budgetRange,
          nights,
          partySize,
          transportPreferences: allTransports,
          customRequests: customRequests.trim() || undefined,
        },
      });
    },
    onSuccess: (data) => {
      router.push(`/generating?planId=${data.id}`);
    },
  });

  if (!destination) return null;

  const toggleTheme = (t: string) =>
    setThemes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const toggleTransport = (t: string) =>
    setTransports((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  return (
    <AppShell title="旅の条件" back={{ href: "/dice" }}>
      <div className="flex flex-1 flex-col pb-6">
        <ol className="flex items-center gap-1.5">
          {FLOW_STEPS.map((s, i) => (
            <li
              key={s.slug}
              className={cn("h-1.5 flex-1 rounded-full", i <= 2 ? "bg-primary" : "bg-surface-2")}
            />
          ))}
        </ol>
        <p className="mt-3 text-xs font-bold tracking-wide text-muted">
          STEP 03 / {String(FLOW_STEPS.length).padStart(2, "0")}
        </p>

        <h1 className="mt-3 text-xl font-extrabold tracking-tight">旅の条件を入力</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          行き先は【{destination.prefecture}
          】です。AIが最高の旅程を作るために、いくつかの希望を教えてください。
        </p>

        <div className="mt-6 flex flex-col gap-8">
          {/* テーマ */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <span className="text-primary">1.</span> 旅のテーマ
            </h2>
            <div className="flex flex-wrap gap-2">
              {THEME_OPTIONS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTheme(t)}
                  className={cn(
                    "px-4 py-2 text-sm font-bold rounded-full border transition-colors",
                    themes.includes(t)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-surface-2 text-foreground border-transparent",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="その他のテーマ（自由記述）"
              className="mt-1 px-4 py-2.5 text-sm rounded-xl border bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
              value={customTheme}
              onChange={(e) => setCustomTheme(e.target.value)}
            />
          </section>

          {/* 予算感 */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <span className="text-primary">2.</span> 1人あたりの予算
            </h2>
            <div className="px-2">
              <div className="flex justify-between text-sm font-bold text-primary mb-2">
                <span>0円</span>
                <span>{budgetRange[1].toLocaleString()}円</span>
              </div>
              <input
                type="range"
                min={0}
                max={200000}
                step={5000}
                value={budgetRange[1]}
                onChange={(e) => setBudgetRange([0, parseInt(e.target.value, 10)])}
                className="w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <p className="mt-2 text-xs text-muted text-right">
                〜 {budgetRange[1].toLocaleString()} 円程度
              </p>
            </div>
          </section>

          {/* 日程・人数 */}
          <section className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <span className="text-primary">3.</span> 日程
              </h2>
              <div className="flex items-center justify-between bg-surface-2 p-1.5 rounded-2xl border">
                <button
                  type="button"
                  onClick={() => setNights((n) => Math.max(0, n - 1))}
                  className="p-2 rounded-xl bg-background shadow-sm disabled:opacity-50"
                  disabled={nights <= 0}
                >
                  <Minus size={16} weight="bold" />
                </button>
                <div className="font-bold text-base w-12 text-center tabular-nums">
                  {nights === 0 ? "日帰り" : `${nights}泊`}
                </div>
                <button
                  type="button"
                  onClick={() => setNights((n) => Math.min(14, n + 1))}
                  className="p-2 rounded-xl bg-background shadow-sm disabled:opacity-50"
                  disabled={nights >= 14}
                >
                  <Plus size={16} weight="bold" />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <span className="text-primary">4.</span> 人数
              </h2>
              <div className="flex items-center justify-between bg-surface-2 p-1.5 rounded-2xl border">
                <button
                  type="button"
                  onClick={() => setPartySize((n) => Math.max(1, n - 1))}
                  className="p-2 rounded-xl bg-background shadow-sm disabled:opacity-50"
                  disabled={partySize <= 1}
                >
                  <Minus size={16} weight="bold" />
                </button>
                <div className="font-bold text-base w-12 text-center tabular-nums">
                  {partySize}人
                </div>
                <button
                  type="button"
                  onClick={() => setPartySize((n) => Math.min(20, n + 1))}
                  className="p-2 rounded-xl bg-background shadow-sm disabled:opacity-50"
                  disabled={partySize >= 20}
                >
                  <Plus size={16} weight="bold" />
                </button>
              </div>
            </div>
          </section>

          {/* 移動手段 */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <span className="text-primary">5.</span> 移動手段の希望
            </h2>
            <div className="flex flex-wrap gap-2">
              {TRANSPORT_OPTIONS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTransport(t)}
                  className={cn(
                    "px-4 py-2 text-sm font-bold rounded-full border transition-colors",
                    transports.includes(t)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-surface-2 text-foreground border-transparent",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="その他の移動手段（自由記述）"
              className="mt-1 px-4 py-2.5 text-sm rounded-xl border bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
              value={customTransport}
              onChange={(e) => setCustomTransport(e.target.value)}
            />
          </section>

          {/* カスタマイズ */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <span className="text-primary">6.</span> その他・こだわり条件
            </h2>
            <textarea
              className="w-full p-4 text-sm rounded-xl border bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              rows={4}
              placeholder="例：どうしても海が見えるホテルに泊まりたい、辛いものが苦手なので配慮してほしい 等"
              value={customRequests}
              onChange={(e) => setCustomRequests(e.target.value)}
            />
          </section>
        </div>

        <div className="mt-10 flex flex-col items-center gap-2">
          <Button
            className="w-full py-6 text-lg font-bold rounded-2xl shadow-lg"
            onClick={() => createPlanMutation.mutate()}
            disabled={createPlanMutation.isPending}
          >
            <SlidersHorizontal size={24} weight="fill" className="mr-2" />
            {createPlanMutation.isPending ? "保存中..." : "この条件で計画を作る"}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
