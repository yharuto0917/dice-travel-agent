"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as d3 from "d3-geo";
import type React from "react";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { geoJsonToShapes, projection } from "@/lib/map";

interface PrefectureMeshProps {
  // biome-ignore lint/suspicious/noExplicitAny: GeoJSON feature is complex
  feature: any;
  highlighted: boolean;
  highlightColor?: string;
  candidateLabel?: string;
  onSelect?: (prefectureId: number, prefectureName: string) => void;
}

export const PrefectureMesh: React.FC<PrefectureMeshProps> = ({
  feature,
  highlighted,
  highlightColor = "#ff6b6b",
  candidateLabel,
  onSelect,
}) => {
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

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

  // アニメーション用の目標値
  // ホバーやハイライト時に少し浮き上がらせる（ミニチュア感を強調）
  const targetY = (hovered ? 0.08 : 0) + (highlighted ? 0.15 : 0);
  const depth = highlighted ? 0.25 : 0.15;

  // 押し出し（立体化）の設定
  const extrudeSettings = useMemo(
    () => ({
      depth: depth,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.015,
      bevelThickness: 0.015,
      curveSegments: 6, // パフォーマンス向上のためセグメント数は控えめに
    }),
    [depth],
  );

  // マテリアルの色設定
  const baseColor = "#e2e8f0"; // slate-200 (標準色)
  const hoverColor = "#cbd5e1"; // slate-300 (ホバー時)
  const activeColor = highlighted ? highlightColor : baseColor;

  useFrame((_state, delta) => {
    if (groupRef.current) {
      // Y位置（浮き上がり）を滑らかに補間
      groupRef.current.position.y = THREE.MathUtils.lerp(
        groupRef.current.position.y,
        targetY,
        12 * delta,
      );
    }

    if (materialRef.current) {
      // マテリアルの色を滑らかに補間
      const targetColor = new THREE.Color(hovered && !highlighted ? hoverColor : activeColor);
      materialRef.current.color.lerp(targetColor, 12 * delta);
    }
  });

  // biome-ignore lint/suspicious/noExplicitAny: R3F pointer event type
  const handleClick = (e: any) => {
    e.stopPropagation();
    onSelect?.(prefectureId, prefectureName);
  };

  return (
    <group ref={groupRef}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: R3F groups are 3D meshes, not HTML interactive elements */}
      <group
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
        }}
        onClick={handleClick}
      >
        {shapes.map((shape, idx) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Prefecture shapes are static, order never changes
          <mesh key={`${prefectureId}-${idx}`} castShadow receiveShadow>
            <extrudeGeometry args={[shape, extrudeSettings]} />
            <meshStandardMaterial
              ref={idx === 0 ? materialRef : undefined}
              color={activeColor}
              roughness={0.5}
              metalness={0.1}
            />
          </mesh>
        ))}

        {/* 候補地のピン・ラベル表示 */}
        {highlighted && (
          <group position={[centroid[0], centroid[1], depth + 0.1]}>
            {/* 3Dのピンの足（シリンダー） */}
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.02, 0.02, 0.2, 8]} />
              <meshStandardMaterial color="#374151" roughness={0.3} />
            </mesh>
            {/* 3Dのピンの頭（スフィア） */}
            <mesh position={[0, 0, 0.1]} castShadow>
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
                className="flex flex-col items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold text-white shadow-lg whitespace-nowrap transition-transform duration-200 scale-90 hover:scale-100"
                style={{
                  backgroundColor: highlightColor,
                  border: "2px solid white",
                  transform: "translateY(-10px)",
                }}
              >
                {candidateLabel && (
                  <span className="opacity-90 text-[10px] leading-none">{candidateLabel}</span>
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
