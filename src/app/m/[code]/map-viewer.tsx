"use client";

// 閲覧画面のマップ部分（F-07）：建物の選択（建物が1つなら非表示）、フロアのタブ、ピンチ・ドラッグ・ボタンでの拡大縮小。
// 店名は、画面上で読める大きさになるまで拡大したときだけ表示する
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import { FloorMapSvg } from "@/components/floor-map/floor-map-svg";
import type { PublicBuilding, PublicFloor, PublicMapData } from "@/lib/public-map";
import { ShopPanel } from "./shop-panel";

/** 店名を表示する、画面上の最小の文字の大きさ（px） */
const MIN_LABEL_SCREEN_PX = 9;
/** これ以上指が動いたら、タップではなく図面の移動とみなす（px） */
const TAP_TOLERANCE_PX = 6;

type Located = { building: PublicBuilding; floor: PublicFloor };

function findFloor(data: PublicMapData, floorId: string | null): Located | null {
  for (const building of data.buildings) {
    const floor = building.floors.find((f) => f.id === floorId);
    if (floor) return { building, floor };
  }
  const building = data.buildings.find((b) => b.floors.length > 0);
  return building ? { building, floor: building.floors[0] } : null;
}

export function MapViewer({ data, initialFloorId }: { data: PublicMapData; initialFloorId: string | null }) {
  const t = useTranslations("viewer");
  const [floorId, setFloorId] = useState<string | null>(() => findFloor(data, initialFloorId)?.floor.id ?? null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const current = findFloor(data, floorId);
  const buildings = data.buildings.filter((b) => b.floors.length > 0);
  const selectedSection = current?.floor.sections.find((s) => s.id === selectedSectionId) ?? null;
  const closePanel = useCallback(() => setSelectedSectionId(null), []);

  function selectFloor(id: string) {
    setFloorId(id);
    setSelectedSectionId(null);
    // 再読み込みや共有をしても同じフロアが開くよう、URL にも残す（画面の再読み込みはしない）
    const url = new URL(window.location.href);
    url.searchParams.set("floor", id);
    window.history.replaceState(window.history.state, "", url);
  }

  if (!current) return <p className="p-6 text-center text-sm text-text-sub">{t("noFloors")}</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b border-line bg-surface px-4 py-2">
        {buildings.length > 1 && (
          <label className="flex items-center gap-2">
            <span className="sr-only">{t("building")}</span>
            <select
              value={current.building.id}
              onChange={(event) => {
                const building = buildings.find((b) => b.id === event.target.value);
                if (building) selectFloor(building.floors[0].id);
              }}
              className="h-11 w-full rounded-xl border border-input-line bg-surface px-3 text-base font-medium"
            >
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div role="tablist" aria-label={t("floorTabs")} className="-mx-1 flex gap-1 overflow-x-auto rounded-xl bg-bg p-1">
          {current.building.floors.map((f) => {
            const selected = f.id === current.floor.id;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectFloor(f.id)}
                className={`h-11 min-w-16 shrink-0 flex-1 rounded-lg px-3 text-sm font-bold ${
                  selected ? "bg-surface text-primary-text shadow-sm" : "text-text-sub"
                }`}
              >
                {f.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-bg">
        {current.floor.image ? (
          // フロアを切り替えたら拡大率を元に戻すため、フロアごとに作り直す。読み込む画像も表示中のフロアの分だけ
          <ZoomableFloor
            key={current.floor.id}
            floor={{ ...current.floor, image: current.floor.image }}
            data={data}
            selectedSectionId={selectedSectionId}
            onSectionSelect={setSelectedSectionId}
            onBackgroundTap={closePanel}
            panelOpen={selectedSection !== null}
          />
        ) : (
          <p className="p-6 text-center text-sm text-text-sub">{t("noImage")}</p>
        )}
        {selectedSection && (
          <ShopPanel
            section={selectedSection}
            building={current.building}
            floor={current.floor}
            genres={data.genres}
            onClose={closePanel}
          />
        )}
      </div>
    </div>
  );
}

function ZoomableFloor({
  floor,
  data,
  selectedSectionId,
  onSectionSelect,
  onBackgroundTap,
  panelOpen,
}: {
  floor: PublicFloor & { image: NonNullable<PublicFloor["image"]> };
  data: PublicMapData;
  selectedSectionId: string | null;
  onSectionSelect: (sectionId: string) => void;
  onBackgroundTap: () => void;
  /** PC では店舗詳細パネルが右側に重なるので、ボタンをパネルの左へずらす */
  panelOpen: boolean;
}) {
  const t = useTranslations("viewer");
  const viewportRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const [fit, setFit] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);
  /** 直前の操作が図面の移動だったか（指を離したときに判定する）。移動のあとの click はタップとして扱わない */
  const wasPan = useRef(false);
  const sectionTapped = useRef(false);

  // 図面を枠いっぱいに収める大きさ（拡大率 1 のとき）
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const ratio = Math.min(width / floor.image.width, height / floor.image.height);
      setFit({ width: floor.image.width * ratio, height: floor.image.height * ratio });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [floor.image.width, floor.image.height]);

  // 画面の1px が画像の何ピクセルか → 店名を表示する最小の大きさ（画像のピクセル）
  const pxPerUnit = fit ? (fit.width / floor.image.width) * scale : 1;
  const minLabelSize = MIN_LABEL_SCREEN_PX / pxPerUnit;

  const button =
    "flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-xl shadow-md active:bg-bg";

  return (
    <div
      ref={viewportRef}
      className="absolute inset-0 overflow-hidden"
      onPointerDownCapture={(event) => {
        pointerDownAt.current = { x: event.clientX, y: event.clientY };
        wasPan.current = false;
      }}
      onPointerUpCapture={(event) => {
        const start = pointerDownAt.current;
        wasPan.current = !!start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_TOLERANCE_PX;
      }}
      onClick={() => {
        // 区画のタップは区画の処理で済んでいる。それ以外の場所をタップしたらパネルを閉じる
        if (sectionTapped.current) {
          sectionTapped.current = false;
          return;
        }
        if (!wasPan.current) onBackgroundTap();
      }}
    >
      {fit && (
        <TransformWrapper
          ref={transformRef}
          minScale={1}
          maxScale={8}
          centerOnInit
          limitToBounds
          onTransform={(_, state) => setScale(state.scale)}
        >
          <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
            <div style={{ width: fit.width, height: fit.height }}>
              <FloorMapSvg
                floor={floor}
                genres={data.genres}
                minLabelSize={minLabelSize}
                selectedSectionId={selectedSectionId}
                onSectionSelect={(id) => {
                  sectionTapped.current = true;
                  if (!wasPan.current) onSectionSelect(id);
                }}
                className="h-full w-full"
              />
            </div>
          </TransformComponent>
        </TransformWrapper>
      )}
      {/* ボタンの操作は「図面の空いている所のタップ（パネルを閉じる）」として扱わない */}
      <div
        className={`absolute right-4 bottom-4 flex flex-col gap-2 ${panelOpen ? "md:right-[25rem]" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" aria-label={t("zoomIn")} onClick={() => transformRef.current?.zoomIn()} className={button}>
          ＋
        </button>
        <button type="button" aria-label={t("zoomOut")} onClick={() => transformRef.current?.zoomOut()} className={button}>
          −
        </button>
        <button type="button" aria-label={t("zoomFit")} onClick={() => transformRef.current?.resetTransform()} className={button}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
