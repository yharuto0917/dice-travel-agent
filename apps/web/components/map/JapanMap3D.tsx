"use client";

import { CircleNotch, HandPointing, Warning } from "@phosphor-icons/react";
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import type React from "react";
import { useEffect, useState } from "react";
import * as topojson from "topojson-client";
import type { MapCandidate } from "@/lib/map";
import { PrefectureMesh } from "./PrefectureMesh";

export type { MapCandidate };

interface JapanMap3DProps {
  candidates?: MapCandidate[];
  selectedPrefectureId?: number | null;
  onSelectPrefecture?: (prefectureId: number, prefectureName: string) => void;
}

export const JapanMap3D: React.FC<JapanMap3DProps> = ({
  candidates = [],
  selectedPrefectureId = null,
  onSelectPrefecture,
}) => {
  const [mounted, setMounted] = useState(false);
  // biome-ignore lint/suspicious/noExplicitAny: GeoJSON features array is complex
  const [mapData, setMapData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // SSR回避
  useEffect(() => {
    setMounted(true);
  }, []);

  // TopoJSONデータのフェッチとパース
  useEffect(() => {
    if (!mounted) return;

    const loadMapData = async () => {
      try {
        setLoading(true);
        const res = await fetch("/japan.topojson");
        if (!res.ok) {
          throw new Error("Failed to fetch map data");
        }
        // biome-ignore lint/suspicious/noExplicitAny: JSON response is untyped
        const topoData = (await res.json()) as any;

        // TopoJSON を GeoJSON に変換
        if (topoData?.objects?.japan) {
          // biome-ignore lint/suspicious/noExplicitAny: topojson-client returns untyped geometry
          const geojson = topojson.feature(topoData, topoData.objects.japan) as any;
          setMapData(geojson.features);
        } else {
          throw new Error("Invalid TopoJSON structure");
        }
        // biome-ignore lint/suspicious/noExplicitAny: fetch error object
      } catch (err: any) {
        console.error("Error loading map data:", err);
        setError(err.message || "地図データの読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    };

    loadMapData();
  }, [mounted]);

  if (!mounted || loading) {
    return (
      <div className="flex h-full min-h-[360px] w-full flex-col items-center justify-center gap-3 bg-surface-2">
        <CircleNotch size={40} weight="bold" className="animate-spin text-primary" />
        <p className="text-sm font-bold text-muted">3D日本地図を読み込み中…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-[360px] w-full flex-col items-center justify-center gap-2 bg-surface-2 p-6 text-center">
        <Warning size={40} weight="fill" className="text-accent" />
        <p className="text-base font-extrabold">読み込みに失敗しました</p>
        <p className="text-xs text-muted">{error}</p>
      </div>
    );
  }

  // 候補地のマッピングを高速化するためのMap作成
  const candidateMap = new Map<number, MapCandidate>();
  for (const c of candidates) {
    candidateMap.set(c.prefectureId, c);
  }

  return (
    <div className="relative h-full min-h-[360px] w-full overflow-hidden rounded-3xl bg-surface-2">
      <Canvas
        // 軽量化: 影・ポストプロセスを廃止し、Retina描画は上限1.5に、
        // 描画は必要時のみ（操作・候補更新時）の frameloop="demand" にする。
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ position: [0, 8, 9], fov: 40 }}
        gl={{ antialias: true, alpha: false }}
      >
        {/* デザイン背景色（--background）に合わせてキャンバスを馴染ませる */}
        <color attach="background" args={["#f4f9f9"]} />

        {/* フォグ効果でミニチュアの奥行き感を演出 */}
        <fog attach="fog" args={["#f4f9f9", 10, 25]} />

        {/* 影を使わないぶん、全体を均一に照らす環境光を強めに */}
        <ambientLight intensity={0.9} />
        {/* メインの平行光源（陰影で立体感を残す。影マップは生成しない） */}
        <directionalLight position={[8, 12, 5]} intensity={1.0} />
        {/* 補助光（暗部を少し起こしてディテールを残す） */}
        <directionalLight position={[-8, 8, -5]} intensity={0.4} />

        {/* 地図コンポーネント群 */}
        <group position={[0, -0.5, 0]}>
          {mapData.map((feature) => {
            const prefId = feature.properties.id;
            const candidate = candidateMap.get(prefId);
            const isHighlighted = !!candidate || selectedPrefectureId === prefId;

            return (
              <PrefectureMesh
                key={prefId}
                feature={feature}
                highlighted={isHighlighted}
                highlightColor={candidate?.color}
                candidateLabel={candidate?.label}
                onSelect={onSelectPrefecture}
              />
            );
          })}

          {/* ミニチュアの土台（テーブル） */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
            <planeGeometry args={[50, 50]} />
            <meshStandardMaterial color="#dce8ea" roughness={0.9} metalness={0.05} />
          </mesh>
        </group>

        {/* カメラ操作制限：裏側に回り込まない、ズーム制限 */}
        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          minDistance={4}
          maxDistance={15}
          maxPolarAngle={Math.PI / 2.3} // 地面スレスレより少し上で止める
          minPolarAngle={Math.PI / 6} // 真上近くまで
        />
      </Canvas>

      {/* 右上の操作ガイド（すりガラスを排し、ソリッド＋ハードシャドウのトイ調に） */}
      <div className="pointer-events-none absolute right-3 top-3 inline-flex select-none items-center gap-1.5 rounded-full border-2 border-line bg-surface px-2.5 py-1 text-[10px] font-bold text-muted shadow-toy">
        <HandPointing size={13} weight="bold" />
        ドラッグで回転 / スクロールでズーム
      </div>
    </div>
  );
};
