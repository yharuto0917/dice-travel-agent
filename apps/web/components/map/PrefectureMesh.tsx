"use client";

import { Html } from "@react-three/drei";
import * as d3 from "d3-geo";
import type React from "react";
import { useMemo } from "react";
import { geoJsonToShapes, projection } from "@/lib/map";

interface PrefectureMeshProps {
  // biome-ignore lint/suspicious/noExplicitAny: GeoJSON feature is complex
  feature: any;
  highlighted: boolean;
  highlightColor?: string;
  candidateLabel?: string;
  onSelect?: (prefectureId: number, prefectureName: string) => void;
}

// 陸地の標準色（土台 #dce8ea より明るくしてジオラマの段差を出す）
const BASE_COLOR = "#f1f7f8";

export const PrefectureMesh: React.FC<PrefectureMeshProps> = ({
  feature,
  highlighted,
  highlightColor = "#ff6b6b",
  candidateLabel,
  onSelect,
}) => {
  const prefectureId = feature.properties.id;
  const prefectureName = feature.properties.nam_ja;

  // GeoJSONフィーチャをTHREE.Shapeに変換
  const shapes = useMemo(() => geoJsonToShapes(feature), [feature]);

  // 県の重心（ピンやラベルの配置用）
  const centroid = useMemo(() => {
    try {
      const c = d3.geoCentroid(feature);
      const proj = projection(c);
      return proj ? [proj[0], -proj[1]] : [0, 0];
    } catch {
      return [0, 0];
    }
  }, [feature]);

  // 候補地は少し高く・厚く押し出して目立たせる（アニメーションはせず静的に配置）
  const raisedY = highlighted ? 0.15 : 0;
  const depth = highlighted ? 0.25 : 0.15;
  const color = highlighted ? highlightColor : BASE_COLOR;

  // 押し出し（立体化）。軽量化のためベベルを無効化しセグメント数を抑える。
  const extrudeSettings = useMemo(
    () => ({
      depth,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 4,
    }),
    [depth],
  );

  // biome-ignore lint/suspicious/noExplicitAny: R3F pointer event type
  const handleClick = (e: any) => {
    e.stopPropagation();
    onSelect?.(prefectureId, prefectureName);
  };

  return (
    <group position={[0, raisedY, 0]}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: R3F groups are 3D meshes, not HTML interactive elements */}
      <group rotation={[-Math.PI / 2, 0, 0]} onClick={handleClick}>
        {shapes.map((shape, idx) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Prefecture shapes are static, order never changes
          <mesh key={`${prefectureId}-${idx}`}>
            <extrudeGeometry args={[shape, extrudeSettings]} />
            <meshStandardMaterial color={color} roughness={0.6} metalness={0.05} />
          </mesh>
        ))}

        {/* 候補地のピン・ラベル表示 */}
        {highlighted && (
          <group position={[centroid[0], centroid[1], depth + 0.1]}>
            {/* 3Dのピンの足（シリンダー）。デザインのインク色に合わせる */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.02, 0.02, 0.2, 8]} />
              <meshStandardMaterial color="#1a2530" roughness={0.3} />
            </mesh>
            {/* 3Dのピンの頭（スフィア） */}
            <mesh position={[0, 0, 0.1]}>
              <sphereGeometry args={[0.06, 16, 16]} />
              <meshStandardMaterial color={highlightColor} roughness={0.2} metalness={0.1} />
            </mesh>

            {/* HTMLラベル */}
            <Html
              distanceFactor={8}
              position={[0, 0, 0.25]}
              center
              className="pointer-events-none select-none"
            >
              <div
                className="flex scale-90 flex-col items-center gap-0.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold text-white"
                style={{
                  backgroundColor: highlightColor,
                  // すりガラス調のソフト影をやめ、インク枠＋ぼかしゼロのハードシャドウへ
                  border: "2px solid #1a2530",
                  boxShadow: "2px 2px 0 0 #1a2530",
                  transform: "translateY(-10px)",
                }}
              >
                {candidateLabel && (
                  <span className="text-[10px] leading-none opacity-90">{candidateLabel}</span>
                )}
                <span className="leading-none">{prefectureName}</span>
              </div>
            </Html>
          </group>
        )}
      </group>
    </group>
  );
};
