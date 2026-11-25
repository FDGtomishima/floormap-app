// 区画の多角形（画像のピクセル座標）。例：[[120,80],[260,80],[260,190],[120,190]]
export type Point = [number, number];

export const POLYGON_LIMITS = { minPoints: 3, maxPoints: 200 } as const;

function isPoint(value: unknown): value is Point {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

/** DB の値（JSON）を多角形として読む。形が違えば null */
export function parsePolygon(value: unknown): Point[] | null {
  if (!Array.isArray(value) || !value.every(isPoint)) return null;
  return value;
}

/** 保存できる多角形にそろえる（画像の範囲内に収め、整数に丸める）。点の数が範囲外なら null */
export function normalizePolygon(value: unknown, width: number, height: number): Point[] | null {
  const points = parsePolygon(value);
  if (!points || points.length < POLYGON_LIMITS.minPoints || points.length > POLYGON_LIMITS.maxPoints) return null;
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));
  return points.map(([x, y]) => [clamp(x, width), clamp(y, height)]);
}

/** 面積の符号付き2倍（向きの判定と重心の計算に使う） */
function signedArea2(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

/** 区画番号などのラベルを置く位置（重心。面積がほぼ0なら頂点の平均） */
export function polygonCentroid(points: Point[]): Point {
  const a2 = signedArea2(points);
  if (Math.abs(a2) < 1e-6) {
    const sx = points.reduce((s, p) => s + p[0], 0);
    const sy = points.reduce((s, p) => s + p[1], 0);
    return [sx / points.length, sy / points.length];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (3 * a2), cy / (3 * a2)];
}

/** 点が多角形の内側にあるか（AI の番号と区画の突き合わせ（工程 7-4）でも使う） */
export function pointInPolygon([x, y]: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
