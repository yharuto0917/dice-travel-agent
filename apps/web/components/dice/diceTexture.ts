import * as THREE from "three";

/** サイコロ1面ぶんのテクスチャ解像度（正方形）。 */
const FACE_SIZE = 512;

/**
 * 2D コンテキストが取れなかったときの代替テクセル（サイコロの地色）。
 *
 * 空の canvas から CanvasTexture を作ると中身が透明＝黒として標本化され、
 * サイコロの面が真っ黒になる。目は失われるが、黒い立方体よりは白い立方体の方が
 * 明らかにマシなので、地色だけの 1x1 テクスチャへフォールバックする。
 */
function createFallbackTexture(): THREE.DataTexture {
  // #fdfdfd 相当（下の塗りつぶしと同じ地色）。
  const data = new Uint8Array([253, 253, 253, 255]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 目の数から1面ぶんのテクスチャを生成する。
 *
 * 返り値は呼び出し側が所有する。**モジュールスコープで生成して使い回してはならない**：
 * r3f は `<Canvas>` のアンマウント時に `forceContextLoss()` で WebGL コンテキストを
 * 破棄するため、コンテキストを跨いで同じテクスチャを共有すると、再訪問時に
 * サイコロの面が黒く描画される。必ずマウント単位で生成し、破棄すること。
 */
export function createDiceTexture(num: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = FACE_SIZE;
  canvas.height = FACE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // 失敗を握り潰すと「サイコロが黒い」という分かりにくい症状だけが残るため、必ず記録する。
    console.error("[dice] 2D コンテキストを取得できませんでした。地色のみで代替します。");
    return createFallbackTexture();
  }

  // Background - Off-white realistic bone/plastic color
  ctx.fillStyle = "#fdfdfd";
  ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE);

  // Subtle bevel/edge shading
  const gradient = ctx.createRadialGradient(256, 256, 180, 256, 256, 360);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, "rgba(0,0,0,0.05)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE);

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

/** BoxGeometry のマテリアル順（+X, -X, +Y, -Y, +Z, -Z）に対応する目の並び。 */
const FACE_ORDER = [1, 6, 2, 5, 3, 4] as const;

/**
 * サイコロ6面ぶんのテクスチャを生成する。
 *
 * 呼び出し側（`Dice`）がマウント単位で生成し、アンマウント時に `dispose()` する。
 * かつてはモジュールスコープの定数配列として全マウントで共有していたが、
 * WebGL コンテキストを跨いだ共有になり、`/dice` へ再訪問した際にサイコロの面が
 * 黒くなる不具合を起こしていた。
 */
export function createDiceTextures(): THREE.Texture[] {
  return FACE_ORDER.map((num) => createDiceTexture(num));
}
