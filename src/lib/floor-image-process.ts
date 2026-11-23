// ブラウザでフロア画像を縮小・圧縮する（F-04 ①）。Client Component からだけ使う
import { FLOOR_IMAGE } from "./floor-image-config";

export type ProcessedImage = { blob: Blob; width: number; height: number; extension: "webp" | "jpg" };
export type ProcessedFloorImage = { edit: ProcessedImage; display: ProcessedImage };

export type FloorImageErrorKey = "unsupportedType" | "tooLarge" | "decodeFailed";

export class FloorImageError extends Error {
  constructor(readonly key: FloorImageErrorKey) {
    super(key);
  }
}

export function validateFloorImageFile(file: File): FloorImageErrorKey | null {
  if (!(FLOOR_IMAGE.acceptTypes as readonly string[]).includes(file.type)) return "unsupportedType";
  if (file.size > FLOOR_IMAGE.maxInputBytes) return "tooLarge";
  return null;
}

function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height)); // 小さい画像は拡大しない
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function encode(source: ImageBitmap, maxEdge: number): Promise<ProcessedImage> {
  const { width, height } = fitWithin(source.width, source.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new FloorImageError("decodeFailed");
  // 透過 PNG の背景を白にする（JPEG にしたとき黒くならないように）
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);

  // WebP に対応していないブラウザでは JPEG にする
  const webp = await canvasToBlob(canvas, "image/webp", FLOOR_IMAGE.quality);
  if (webp && webp.type === "image/webp") return { blob: webp, width, height, extension: "webp" };
  const jpeg = await canvasToBlob(canvas, "image/jpeg", FLOOR_IMAGE.quality);
  if (!jpeg) throw new FloorImageError("decodeFailed");
  return { blob: jpeg, width, height, extension: "jpg" };
}

export async function processFloorImage(file: File): Promise<ProcessedFloorImage> {
  const invalid = validateFloorImageFile(file);
  if (invalid) throw new FloorImageError(invalid);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new FloorImageError("decodeFailed");
  }
  try {
    const edit = await encode(bitmap, FLOOR_IMAGE.editMaxEdge);
    const display = await encode(bitmap, FLOOR_IMAGE.displayMaxEdge);
    return { edit, display };
  } finally {
    bitmap.close();
  }
}
