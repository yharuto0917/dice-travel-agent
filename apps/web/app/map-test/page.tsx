"use client";

import { useState } from "react";
import { JapanMap3D, type MapCandidate } from "@/components/map/JapanMap3D";

const SAMPLE_CANDIDATES: MapCandidate[] = [
  { prefectureId: 1, prefectureName: "北海道", color: "#3b82f6", label: "候補 1" },
  { prefectureId: 13, prefectureName: "東京都", color: "#f97316", label: "候補 2" },
  { prefectureId: 26, prefectureName: "京都府", color: "#ec4899", label: "候補 3" },
  { prefectureId: 27, prefectureName: "大阪府", color: "#a855f7", label: "候補 4" },
  { prefectureId: 40, prefectureName: "福岡県", color: "#10b981", label: "候補 5" },
  { prefectureId: 47, prefectureName: "沖縄県", color: "#f43f5e", label: "候補 6" },
];

export default function MapTestPage() {
  const [selectedPref, setSelectedPref] = useState<{ id: number; name: string } | null>(null);
  const [enableEffects, setEnableEffects] = useState(true);

  const handleSelectPref = (id: number, name: string) => {
    setSelectedPref({ id, name });
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 p-6 md:p-12">
      <div className="max-w-6xl w-full mx-auto flex flex-col gap-8">
        {/* ヘッダー */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">
              3D 日本地図コンポーネント テスト
            </h1>
            <p className="text-slate-500 mt-1">
              Three.js (React Three Fiber) + Post-processing を使ったミニチュア風日本地図のデモ
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEnableEffects(!enableEffects)}
              className={`px-4 py-2 rounded-full font-semibold text-sm shadow-sm border transition-all ${
                enableEffects
                  ? "bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {enableEffects ? "✨ ポストプロセスON" : "🔇 ポストプロセスOFF"}
            </button>
          </div>
        </div>

        {/* メインレイアウト */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* 左側：地図の描画エリア */}
          <div className="lg:col-span-2 aspect-[4/3] w-full min-h-[500px] shadow-lg rounded-3xl bg-white border border-slate-100 overflow-hidden">
            <JapanMap3D
              candidates={SAMPLE_CANDIDATES}
              selectedPrefectureId={selectedPref?.id}
              onSelectPrefecture={handleSelectPref}
              enableEffects={enableEffects}
            />
          </div>

          {/* 右側：情報パネル */}
          <div className="flex flex-col gap-6">
            {/* 選択された都道府県情報 */}
            <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-md">
              <h2 className="text-lg font-bold text-slate-700 mb-4">選択中の都道府県</h2>
              {selectedPref ? (
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div>
                    <p className="text-2xl font-black text-slate-800">{selectedPref.name}</p>
                    <p className="text-xs text-slate-400 mt-1">ID: {selectedPref.id}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPref(null)}
                    className="text-xs font-bold text-red-500 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    解除
                  </button>
                </div>
              ) : (
                <p className="text-slate-400 text-sm py-4 text-center border border-dashed border-slate-200 rounded-2xl">
                  地図上の都道府県をクリックまたはタップしてください。
                </p>
              )}
            </div>

            {/* 候補地リスト */}
            <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-md">
              <h2 className="text-lg font-bold text-slate-700 mb-4">候補都道府県リスト (6箇所)</h2>
              <div className="flex flex-col gap-2.5">
                {SAMPLE_CANDIDATES.map((candidate) => {
                  const isSelected = selectedPref?.id === candidate.prefectureId;
                  return (
                    <button
                      type="button"
                      key={candidate.prefectureId}
                      onClick={() =>
                        handleSelectPref(candidate.prefectureId, candidate.prefectureName)
                      }
                      className={`flex items-center gap-3 w-full p-3 rounded-2xl border text-left transition-all ${
                        isSelected
                          ? "border-slate-800 bg-slate-900 text-white shadow-md"
                          : "border-slate-100 bg-slate-50 hover:bg-slate-100 text-slate-700"
                      }`}
                    >
                      <span
                        className="w-4 h-4 rounded-full border border-white shrink-0"
                        style={{ backgroundColor: candidate.color }}
                      />
                      <div className="flex-1">
                        <p className="text-xs font-semibold opacity-75">{candidate.label}</p>
                        <p className="text-sm font-bold">{candidate.prefectureName}</p>
                      </div>
                      <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                        ID: {candidate.prefectureId}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
