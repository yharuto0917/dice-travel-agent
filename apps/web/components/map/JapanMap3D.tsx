"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Bloom, DepthOfField, EffectComposer } from "@react-three/postprocessing";
import type React from "react";
import { useEffect, useState } from "react";
import * as topojson from "topojson-client";
import { PrefectureMesh } from "./PrefectureMesh";

export interface MapCandidate {
  prefectureId: number;
  prefectureName: string;
  color: string;
  label: string;
}

interface JapanMap3DProps {
  candidates?: MapCandidate[];
  selectedPrefectureId?: number | null;
  onSelectPrefecture?: (prefectureId: number, prefectureName: string) => void;
  enableEffects?: boolean;
}

export const JapanMap3D: React.FC<JapanMap3DProps> = ({
  candidates = [],
  selectedPrefectureId = null,
  onSelectPrefecture,
  enableEffects = true,
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
      <div className="flex flex-col items-center justify-center w-full h-full bg-slate-50 min-h-[400px]">
        <div className="relative w-16 h-16 mb-4">
          <div className="absolute inset-0 rounded-full border-4 border-slate-200 border-t-indigo-600 animate-spin" />
        </div>
        <p className="text-sm font-semibold text-slate-500 animate-pulse">
          3D日本地図を読み込み中...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full bg-red-50 text-red-500 p-6 rounded-2xl min-h-[400px]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-12 h-12 mb-3"
        >
          <title>エラーアイコン</title>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 7.5h.008v.008H12v-.008Z"
          />
        </svg>
        <p className="font-bold text-lg mb-1">エラーが発生しました</p>
        <p className="text-sm opacity-90">{error}</p>
      </div>
    );
  }

  // 候補地のマッピングを高速化するためのMap作成
  const candidateMap = new Map<number, MapCandidate>();
  for (const c of candidates) {
    candidateMap.set(c.prefectureId, c);
  }

  return (
    <div className="relative w-full h-full min-h-[400px] bg-slate-50 rounded-3xl overflow-hidden border border-slate-100 shadow-inner">
      <Canvas
        shadows
        camera={{ position: [0, 8, 9], fov: 40 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={["#fafafa"]} />

        {/* フォグ効果でミニチュアの奥行き感を演出 */}
        <fog attach="fog" args={["#fafafa", 10, 25]} />

        {/* 柔らかい環境光 */}
        <ambientLight intensity={0.7} />

        {/* メインの平行光源（太陽光、影を作る） */}
        <directionalLight
          castShadow
          position={[8, 12, 5]}
          intensity={1.2}
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={30}
          shadow-camera-left={-6}
          shadow-camera-right={6}
          shadow-camera-top={6}
          shadow-camera-bottom={-6}
          shadow-bias={-0.0005}
        />

        {/* 補助光（影の部分を少し明るくしてディテールを残す） */}
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
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow>
            <planeGeometry args={[50, 50]} />
            <meshStandardMaterial color="#f1f5f9" roughness={0.9} metalness={0.05} />
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

        {/* 被写界深度（tilt-shift）とブルーム効果によるミニチュア風ポストプロセス */}
        {enableEffects && (
          <EffectComposer>
            <DepthOfField
              focusDistance={0.42} // カメラからの焦点距離（0.0〜1.0）
              focalLength={0.04} // レンズの焦点距離（大きいほどボケる）
              bokehScale={3.5} // ボケの強さ
            />
            <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.9} height={300} intensity={0.2} />
          </EffectComposer>
        )}
      </Canvas>

      {/* 右上の操作ガイド */}
      <div className="absolute top-4 right-4 bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-100 text-[10px] font-medium text-slate-500 shadow-sm pointer-events-none select-none">
        🖱️ ドラッグで回転 / スクロールでズーム
      </div>
    </div>
  );
};
