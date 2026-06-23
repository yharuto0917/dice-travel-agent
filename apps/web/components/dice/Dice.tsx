import { useBox } from "@react-three/cannon";
import * as React from "react";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { diceTextures } from "./diceTexture";

const faceVectors = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];
const faceNumbers = [1, 6, 2, 5, 3, 4];

interface DiceProps {
  gameState: "idle" | "rolling" | "finished";
  onRollComplete: (num: number) => void;
  triggerRoll: number;
}

export function Dice({ gameState, onRollComplete, triggerRoll }: DiceProps) {
  const [ref, api] = useBox(() => ({
    mass: 1,
    args: [1.2, 1.2, 1.2], // Slightly larger for better visibility
    position: [0, 4, 0],
    rotation: [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI],
    material: { restitution: 0.6, friction: 0.1 },
    sleepSpeedLimit: 0.05,
    sleepTimeLimit: 0.5,
    allowSleep: true,
  }));

  const velocity = useRef([0, 0, 0]);
  const angularVelocity = useRef([0, 0, 0]);
  // 投擲後に一度でも明確に動いたかを記録する。
  // これを満たすまで静止判定を行わないことで、再投擲直後に worker への
  // 速度反映が遅れて「静止」と誤検出し、振り直し前の出目を返す事故を防ぐ。
  const hasMoved = useRef(false);

  useEffect(() => {
    const unsubscribeVel = api.velocity.subscribe((v) => {
      velocity.current = v;
      if (Math.abs(v[0]) > 1 || Math.abs(v[1]) > 1 || Math.abs(v[2]) > 1) {
        hasMoved.current = true;
      }
    });
    const unsubscribeAngVel = api.angularVelocity.subscribe((v) => {
      angularVelocity.current = v;
    });
    return () => {
      unsubscribeVel();
      unsubscribeAngVel();
    };
  }, [api]);

  // Roll trigger
  useEffect(() => {
    if (triggerRoll > 0) {
      // 新しい投擲の開始。前回の「動いた」記録をリセットする。
      hasMoved.current = false;
      api.wakeUp();
      // Start higher to allow for a good drop and bounce, but within boundaries
      api.position.set((Math.random() - 0.5) * 2, 4, (Math.random() - 0.5) * 2);

      // Controlled random spin and toss to stay on screen
      api.velocity.set((Math.random() - 0.5) * 4, Math.random() * 3 + 2, (Math.random() - 0.5) * 4);
      api.angularVelocity.set(
        Math.random() * 15 - 7.5,
        Math.random() * 15 - 7.5,
        Math.random() * 15 - 7.5,
      );
    }
  }, [triggerRoll, api]);

  // Check when roll is complete
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    if (gameState === "rolling") {
      // Poll to check if dice has stopped
      interval = setInterval(() => {
        const isSteady =
          Math.abs(velocity.current[0]) < 0.05 &&
          Math.abs(velocity.current[1]) < 0.05 &&
          Math.abs(velocity.current[2]) < 0.05 &&
          Math.abs(angularVelocity.current[0]) < 0.05 &&
          Math.abs(angularVelocity.current[1]) < 0.05 &&
          Math.abs(angularVelocity.current[2]) < 0.05;

        // 投擲後に一度も動いていない（worker への反映待ち）間は確定しない。
        if (isSteady && hasMoved.current && ref.current) {
          const quaternion = new THREE.Quaternion();
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          (ref.current as THREE.Object3D).getWorldQuaternion(quaternion);
          const upVector = new THREE.Vector3(0, 1, 0);

          let maxDot = -Infinity;
          let topFace = 1;
          for (let i = 0; i < faceVectors.length; i++) {
            const v = faceVectors[i].clone().applyQuaternion(quaternion);
            const dot = v.dot(upVector);
            if (dot > maxDot) {
              maxDot = dot;
              topFace = faceNumbers[i];
            }
          }
          // 再レンダリングで gameState が "finished" になる前に次の tick が
          // 二重発火しないよう、確定と同時にインターバルを止める。
          clearInterval(interval);
          onRollComplete(topFace);
        }
      }, 300);
    }
    return () => clearInterval(interval);
  }, [gameState, onRollComplete, ref]);

  const geom = React.useMemo(() => new RoundedBoxGeometry(1.2, 1.2, 1.2, 4, 0.1), []);

  return (
    <mesh
      // biome-ignore lint/suspicious/noExplicitAny: Cannon ref typing compatibility
      ref={ref as any}
      castShadow
      receiveShadow
      geometry={geom}
    >
      {diceTextures.map((texture, index) => (
        <meshStandardMaterial
          key={`texture-${index.toString()}`}
          attach={`material-${index}`}
          map={texture}
          roughness={0.2}
          metalness={0.1}
        />
      ))}
    </mesh>
  );
}
