// フロアの図面と区画を描く部品（閲覧画面用）。
// 区画がとても多くて重い場合に Canvas（Konva など）へ切り替えられるよう、描画はこの部品にまとめる（docs/01_spec.md 7.）
import type { PublicFloor, PublicGenre, PublicSection } from "@/lib/public-map";
import { polygonCentroid, type Point } from "@/lib/polygon";

type Props = {
  floor: PublicFloor & { image: NonNullable<PublicFloor["image"]> };
  genres: PublicGenre[];
  /**
   * 店名を表示する最小の文字の大きさ（画像のピクセル）。これより小さくしか入らない店名は表示しない。
   * 閲覧画面では「画面上で約9px」を拡大率から換算して渡し、縮小中は省略・拡大したときだけ表示する（docs/01_spec.md 7.）
   */
  minLabelSize?: number;
  /** 選択中の区画（枠を太くする） */
  selectedSectionId?: string | null;
  /** 区画をタップしたとき（閲覧画面では店舗詳細パネルを開く） */
  onSectionSelect?: (sectionId: string) => void;
  className?: string;
};

function bounds(points: Point[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** 文字の幅のおおよその合計（全角を1、半角を0.55として数える） */
function textUnits(text: string): number {
  let units = 0;
  for (const ch of text) units += /[\u0000-ÿ]/.test(ch) ? 0.55 : 1;
  return Math.max(units, 1);
}

/** 店名の基本の大きさ：図面の長辺に対する割合。短い店名でもこれ以上は大きくしない（見た目をそろえるため） */
const LABEL_BASE_RATIO = 0.022;

/** 区画の大きさに収まる文字の大きさ（画像のピクセル） */
function labelSize(section: PublicSection, name: string, base: number): number {
  const { width, height } = bounds(section.points);
  return Math.max(4, Math.min(base, height * 0.3, (width * 0.85) / textUnits(name)));
}

export function FloorMapSvg({ floor, genres, minLabelSize = 0, selectedSectionId = null, onSectionSelect, className }: Props) {
  const genreById = new Map(genres.map((g) => [g.id, g]));
  const { width, height, url } = floor.image;
  const labelBase = Math.max(width, height) * LABEL_BASE_RATIO;
  const interactive = onSectionSelect !== undefined;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className={className} role="img" aria-label={floor.name}>
      <image href={url} width={width} height={height} preserveAspectRatio="none" />
      {floor.sections.map((section) => {
        const points = section.points.map(([x, y]) => `${x},${y}`).join(" ");
        const shop = section.shop;
        const genre = shop?.genreId ? genreById.get(shop.genreId) : undefined;
        const selected = section.id === selectedSectionId;
        const fontSize = shop ? labelSize(section, shop.name, labelBase) : 0;
        const [cx, cy] = polygonCentroid(section.points);

        // 塗りと枠（docs/03_ui-design.md「区画の状態の表し方」）
        //   通常：ジャンルの塗り＋1.5px の枠 ／ 選択中：枠を 3px ／ 店舗なし：注意色の 2px 点線
        const style = !shop
          ? { className: "fill-warning-bg-light/80 stroke-warning-line-strong", strokeWidth: 2, dash: "6 4" }
          : { className: genre ? "" : "fill-bg stroke-text-sub", strokeWidth: 1.5, dash: undefined };

        return (
          <g
            key={section.id}
            onClick={interactive ? () => onSectionSelect(section.id) : undefined}
            className={interactive ? "cursor-pointer" : undefined}
          >
            <polygon
              points={points}
              vectorEffect="non-scaling-stroke"
              strokeWidth={selected ? 3 : style.strokeWidth}
              strokeDasharray={selected ? undefined : style.dash}
              strokeLinejoin="round"
              fill={shop ? genre?.fillColor : undefined}
              stroke={shop && !selected ? genre?.lineColor : undefined}
              className={`${style.className} ${selected ? "stroke-primary" : ""}`}
            />
            {shop && fontSize >= minLabelSize && (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                fill={genre?.textColor}
                className={`pointer-events-none select-none font-bold ${genre ? "" : "fill-text"}`}
              >
                {shop.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
