import * as THREE from "three";

export function createDiceTexture(num: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Background - Off-white realistic bone/plastic color
  ctx.fillStyle = "#fdfdfd";
  ctx.fillRect(0, 0, 512, 512);

  // Subtle bevel/edge shading
  const gradient = ctx.createRadialGradient(256, 256, 180, 256, 256, 360);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, "rgba(0,0,0,0.05)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);

  // Dots
  const drawDot = (x: number, y: number) => {
    // Drop shadow
    ctx.beginPath();
    ctx.arc(x, y + 2, 50, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.fill();

    // Main Dot
    ctx.beginPath();
    ctx.arc(x, y, 48, 0, Math.PI * 2);
    ctx.fillStyle = num === 1 ? "#d32f2f" : "#212121";
    ctx.fill();

    // Inner shadow/depth
    ctx.beginPath();
    ctx.arc(x - 4, y - 4, 40, 0, Math.PI * 2);
    ctx.fillStyle = num === 1 ? "#b71c1c" : "#111111";
    ctx.fill();

    // Highlight
    ctx.beginPath();
    ctx.arc(x - 12, y - 12, 10, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.fill();
  };

  const center = 256;
  const offset = 130;

  if (num === 1 || num === 3 || num === 5) drawDot(center, center);
  if (num === 2 || num === 3 || num === 4 || num === 5 || num === 6) {
    drawDot(center - offset, center - offset);
    drawDot(center + offset, center + offset);
  }
  if (num === 4 || num === 5 || num === 6) {
    drawDot(center - offset, center + offset);
    drawDot(center + offset, center - offset);
  }
  if (num === 6) {
    drawDot(center - offset, center);
    drawDot(center + offset, center);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 16;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const diceTextures = [
  createDiceTexture(1), // +X
  createDiceTexture(6), // -X
  createDiceTexture(2), // +Y
  createDiceTexture(5), // -Y
  createDiceTexture(3), // +Z
  createDiceTexture(4), // -Z
];
