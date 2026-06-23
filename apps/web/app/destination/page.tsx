"use client";

import { ArrowRight, Shuffle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { JapanMap3D } from "@/components/map/JapanMap3D";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FLOW_STEPS } from "@/lib/flow";
import type { MapCandidate } from "@/lib/map";
import { pickRandomCandidates } from "@/lib/prefectures";
import { cn } from "@/lib/utils";

export default function DestinationPage() {
  // 候補はユーザーが選ぶのではなく、毎回ランダムに6つ提示する。
  // SSRとのハイドレーション不整合を避けるため、マウント後に生成する。
  const [candidates, setCandidates] = useState<MapCandidate[]>([]);

  useEffect(() => {
    setCandidates(pickRandomCandidates());
  }, []);

  const reroll = () => setCandidates(pickRandomCandidates());

  return (
    <AppShell title="行き先候補" back={{ href: "/" }}>
      <div className="flex flex-1 flex-col">
        {/* 進捗ステッパー（STEP 1 / 5） */}
        <ol className="flex items-center gap-1.5">
          {FLOW_STEPS.map((s, i) => (
            <li
              key={s.slug}
              className={cn("h-1.5 flex-1 rounded-full", i <= 0 ? "bg-primary" : "bg-surface-2")}
            />
          ))}
        </ol>
        <p className="mt-3 text-xs font-bold tracking-wide text-muted">
          STEP 01 / {String(FLOW_STEPS.length).padStart(2, "0")}
        </p>

        <h1 className="mt-3 text-xl font-extrabold tracking-tight">行き先候補が決まりました</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          日本地図からランダムに6つの行き先をピックアップしました。次はサイコロを振って、行き先を1つに決めます。
        </p>

        {/* 3D 日本地図（候補をピンで表示） */}
        <Card className="mt-4 overflow-hidden p-0">
          <div className="aspect-[4/3] min-h-[360px] w-full">
            <JapanMap3D candidates={candidates} />
          </div>
        </Card>

        {/* 候補リスト（表示専用） */}
        <ul className="mt-4 grid grid-cols-2 gap-2">
          {candidates.map((c) => (
            <li
              key={c.prefectureId}
              className="flex items-center gap-2.5 rounded-2xl border-2 border-line bg-surface px-3 py-2 shadow-toy"
            >
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-line"
                style={{ backgroundColor: c.color }}
              />
              <span className="min-w-0">
                <span className="block text-[10px] font-bold text-muted">{c.label}</span>
                <span className="block truncate text-sm font-bold">{c.prefectureName}</span>
              </span>
            </li>
          ))}
        </ul>

        {/* アクション */}
        <div className="mt-auto flex items-center gap-3 pt-6">
          <Button type="button" variant="outline" className="flex-1" onClick={reroll}>
            <Shuffle size={18} weight="bold" />
            引き直す
          </Button>
          <Link href="/dice" className={cn(buttonVariants(), "flex-1")}>
            サイコロを振る
            <ArrowRight size={18} weight="bold" />
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
