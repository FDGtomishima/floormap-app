// ジャンルの色の選択肢（docs/03_ui-design.md「ジャンル色」）。
// 管理者はこの中から選ぶ（自由な色にすると、文字が読みにくい組み合わせや、
// 「番号未設定」「エラー」などの役割色と紛らわしい色になりやすいため）。
// 最初の6色は初期ジャンルの色。7色目以降は、追加したジャンル用に見分けやすい色を足したもの
export type GenreColorPreset = {
  id: string;
  /** 管理画面で色の名前として表示する */
  label: string;
  fill: string;
  line: string;
  text: string;
};

export const GENRE_COLOR_PRESETS: readonly GenreColorPreset[] = [
  { id: "orange", label: "オレンジ", fill: "#FFE8D6", line: "#E8833A", text: "#8A4210" },
  { id: "blue", label: "青", fill: "#DCEBFF", line: "#3B82F6", text: "#1E4E9C" },
  { id: "purple", label: "紫", fill: "#EDE4FF", line: "#8B5CF6", text: "#5B2EB8" },
  { id: "green", label: "緑", fill: "#D9F5EA", line: "#10B981", text: "#0B6B4C" },
  { id: "pink", label: "ピンク", fill: "#FFE1EC", line: "#EC4899", text: "#9D174D" },
  { id: "gray", label: "灰色", fill: "#ECEEF1", line: "#9AA3AE", text: "#4B5563" },
  { id: "teal", label: "青緑", fill: "#CCFBF1", line: "#14B8A6", text: "#115E59" },
  { id: "indigo", label: "藍", fill: "#E0E7FF", line: "#6366F1", text: "#3730A3" },
  { id: "lime", label: "黄緑", fill: "#ECFCCB", line: "#84CC16", text: "#3F6212" },
  { id: "cyan", label: "水色", fill: "#CFFAFE", line: "#06B6D4", text: "#155E75" },
  { id: "brown", label: "茶", fill: "#F3E8DC", line: "#A0522D", text: "#6B3410" },
  { id: "fuchsia", label: "赤紫", fill: "#FAE8FF", line: "#D946EF", text: "#86198F" },
];

export function findGenrePreset(id: string): GenreColorPreset | undefined {
  return GENRE_COLOR_PRESETS.find((p) => p.id === id);
}

/** 保存されている色がどの選択肢か（大文字・小文字は区別しない）。選択肢にない色なら undefined */
export function presetOfColors(colors: { fill: string; line: string; text: string }): GenreColorPreset | undefined {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return GENRE_COLOR_PRESETS.find((p) => same(p.fill, colors.fill) && same(p.line, colors.line) && same(p.text, colors.text));
}

/** 新しいジャンルの色：まだ使われていない選択肢のうち、最初のもの */
export function nextFreePreset(used: { fill: string; line: string; text: string }[]): GenreColorPreset {
  const usedIds = new Set(used.map((c) => presetOfColors(c)?.id));
  return GENRE_COLOR_PRESETS.find((p) => !usedIds.has(p.id)) ?? GENRE_COLOR_PRESETS[0];
}
