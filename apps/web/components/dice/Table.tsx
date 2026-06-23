import { usePlane } from "@react-three/cannon";
import type * as THREE from "three";

export function Table() {
  const [ref] = usePlane(() => ({
    rotation: [-Math.PI / 2, 0, 0],
    position: [0, -0.6, 0], // Position slightly lower to accommodate dice size
    material: { restitution: 0.4, friction: 0.3 },
  }));

  // Invisible walls to keep the dice strictly in frame
  const BOUND = 3.5;
  usePlane(() => ({ position: [0, 0, -BOUND], rotation: [0, 0, 0] }));
  usePlane(() => ({ position: [0, 0, BOUND], rotation: [0, -Math.PI, 0] }));
  usePlane(() => ({ position: [-BOUND, 0, 0], rotation: [0, Math.PI / 2, 0] }));
  usePlane(() => ({ position: [BOUND, 0, 0], rotation: [0, -Math.PI / 2, 0] }));

  // Invisible ceiling
  usePlane(() => ({ position: [0, 8, 0], rotation: [Math.PI / 2, 0, 0] }));

  return (
    <mesh ref={ref as React.Ref<THREE.Mesh>} receiveShadow>
      <planeGeometry args={[100, 100]} />
      {/* デザインを既存のJapanMap3Dのテーブル（#dce8ea）に合わせる */}
      <meshStandardMaterial color="#dce8ea" roughness={0.9} metalness={0.05} />
    </mesh>
  );
}
