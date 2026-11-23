// フロア画像の条件（仮の値。docs/01_spec.md「推奨する画像の条件」はテスト版の結果を見て決める）
export const FLOOR_IMAGE = {
  /** 受け付ける形式 */
  acceptTypes: ["image/png", "image/jpeg"] as const,
  /** 受け付ける最大サイズ（元の画像） */
  maxInputBytes: 20 * 1024 * 1024,
  /** 編集用：長辺の最大ピクセル。区画の座標はこの画像のピクセルを基準にする */
  editMaxEdge: 4096,
  /** 表示用（閲覧画面）：長辺の最大ピクセル */
  displayMaxEdge: 2048,
  /** 圧縮の品質（0〜1） */
  quality: 0.85,
} as const;

export const MAP_IMAGES_BUCKET = "map-images";
