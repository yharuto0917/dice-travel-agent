import { Physics } from "@react-three/cannon";
import { Canvas } from "@react-three/fiber";
import type { DiceFace } from "@repo/shared";
import { useDiceStore } from "@/lib/stores/diceStore";
import { Dice } from "./Dice";
import { Table } from "./Table";

export type GameState = "idle" | "rolling" | "finished";

interface DiceSceneProps {
  onRollComplete?: (face: DiceFace) => void;
  gameState: GameState;
  setGameState: (state: GameState) => void;
  triggerRollCount: number;
}

export function DiceScene({
  onRollComplete,
  gameState,
  setGameState,
  triggerRollCount,
}: DiceSceneProps) {
  const store = useDiceStore();

  const handleRollComplete = (topFace: number) => {
    // Only accept 1-6
    if (topFace >= 1 && topFace <= 6) {
      store.rollDice(topFace as DiceFace);
      setGameState("finished");
      onRollComplete?.(topFace as DiceFace);
    }
  };

  return (
    <Canvas shadows camera={{ position: [0, 7, 7], fov: 40 }}>
      <ambientLight intensity={0.6} />
      <directionalLight
        castShadow
        position={[4, 10, 4]}
        intensity={1.8}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
      >
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 50]} />
      </directionalLight>

      {/* 反射用の環境マップ（drei の <Environment preset="city" />）は外部CDNからHDRを
          取得する。読み込み中は Suspense がシーン全体を保留するため、取得が遅い/失敗する環境では
          サイコロが描画されない。視覚的寄与も小さい（dice は metalness 0.1）ため不採用とし、
          ライティングのみで陰影をつける。反射が必要になった場合はネットワーク非依存の手段を検討する。 */}

      <Physics gravity={[0, -20, 0]}>
        <Table />
        <Dice
          gameState={gameState}
          onRollComplete={handleRollComplete}
          triggerRoll={triggerRollCount}
        />
      </Physics>
    </Canvas>
  );
}
