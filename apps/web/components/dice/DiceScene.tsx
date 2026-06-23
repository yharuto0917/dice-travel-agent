import { Physics } from "@react-three/cannon";
import { Environment } from "@react-three/drei";
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

      <Environment preset="city" />

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
