import * as d3 from "d3-geo";
import * as THREE from "three";

// 日本の中心付近の座標
export const MAP_CENTER: [number, number] = [138.5, 36.5];
// Three.js空間での地図の大きさに合わせたスケール調整
export const MAP_SCALE = 15;

export const projection = d3.geoMercator().center(MAP_CENTER).scale(MAP_SCALE).translate([0, 0]);

/**
 * GeoJSON の Feature (Polygon または MultiPolygon) から THREE.Shape の配列を生成します。
 */
// biome-ignore lint/suspicious/noExplicitAny: GeoJSON feature is complex and comes from untyped third-party JSON
export function geoJsonToShapes(geojsonFeature: any): THREE.Shape[] {
  const shapes: THREE.Shape[] = [];
  const geometry = geojsonFeature.geometry;
  if (!geometry) return shapes;

  if (geometry.type === "Polygon") {
    shapes.push(createPolygonShape(geometry.coordinates));
  } else if (geometry.type === "MultiPolygon") {
    for (const polygonCoords of geometry.coordinates) {
      shapes.push(createPolygonShape(polygonCoords));
    }
  }
  return shapes;
}

/**
 * ひとつのポリゴン座標データ（外輪と内輪の穴）から THREE.Shape を生成します。
 */
function createPolygonShape(coordinates: number[][][]): THREE.Shape {
  // 外郭（アウターリング）
  const exteriorCoords = coordinates[0];
  const shape = new THREE.Shape();

  if (exteriorCoords && exteriorCoords.length > 0) {
    const firstPoint = exteriorCoords[0];
    if (firstPoint) {
      const firstProj = projection([firstPoint[0], firstPoint[1]]);
      if (firstProj) {
        // Three.jsの座標系に合わせるため、Y軸を反転 (-firstProj[1]) する
        shape.moveTo(firstProj[0], -firstProj[1]);
      }
    }

    for (let i = 1; i < exteriorCoords.length; i++) {
      const point = exteriorCoords[i];
      if (point) {
        const proj = projection([point[0], point[1]]);
        if (proj) {
          shape.lineTo(proj[0], -proj[1]);
        }
      }
    }
  }

  // 穴（インナーリング）
  for (let i = 1; i < coordinates.length; i++) {
    const holeCoords = coordinates[i];
    if (holeCoords && holeCoords.length > 0) {
      const holePath = new THREE.Path();
      const firstPoint = holeCoords[0];
      if (firstPoint) {
        const firstProj = projection([firstPoint[0], firstPoint[1]]);
        if (firstProj) {
          holePath.moveTo(firstProj[0], -firstProj[1]);
        }
      }

      for (let j = 1; j < holeCoords.length; j++) {
        const point = holeCoords[j];
        if (point) {
          const proj = projection([point[0], point[1]]);
          if (proj) {
            holePath.lineTo(proj[0], -proj[1]);
          }
        }
      }
      shape.holes.push(holePath);
    }
  }

  return shape;
}
