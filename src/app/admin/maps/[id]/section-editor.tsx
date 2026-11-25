"use client";

// 区画エディタ（F-05 / 工程 2-3）：図面の上で多角形を描く・頂点を動かす・削除する。
// 座標は編集用画像のピクセル。SVG の viewBox を画像の大きさにして、拡大縮小は react-zoom-pan-pinch で行う
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import { polygonCentroid, POLYGON_LIMITS, type Point } from "@/lib/polygon";
import { checkSectionNumber, normalizeCode } from "@/lib/section-number";
import type { SectionSource } from "@/types/database";
import { createSection, deleteSection, updateSectionNumber, updateSectionPoints, type SectionErrorKey } from "./section-actions";

export type EditorSection = {
  id: string;
  number: string | null;
  points: Point[];
  source: SectionSource;
  hasShop: boolean;
};

type Mode = "select" | "draw";
type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; error: SectionErrorKey | "tooFewPoints" };
type Drag = { sectionId: string; index: number; moved: boolean };

/** 画面上のピクセルでの大きさ（拡大率に関係なく同じ見た目にする） */
const HANDLE_RADIUS_PX = 7;
const MIDPOINT_RADIUS_PX = 4;
const CLOSE_DISTANCE_PX = 12;
const CLICK_TOLERANCE_PX = 5;
const LABEL_SIZE_PX = 12;
/** 図面をドラッグで動かさない要素に付けるクラス（react-zoom-pan-pinch の panning.excluded） */
const NO_PAN = "fm-no-pan";

function needsReview(section: EditorSection): "unnumbered" | "invalid" | null {
  if (!section.number) return "unnumbered";
  return checkSectionNumber(section.number).ok ? null : "invalid";
}

export function SectionEditor({
  floorId,
  image,
  initialSections,
}: {
  floorId: string;
  image: { url: string; width: number; height: number };
  initialSections: EditorSection[];
}) {
  const t = useTranslations("sectionEditor");
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);
  /** サーバーに保存済みの形（保存に失敗したときに戻すため） */
  const savedPoints = useRef(new Map(initialSections.map((s) => [s.id, s.points])));

  const [sections, setSections] = useState<EditorSection[]>(initialSections);
  // 最新の区画と描きかけの頂点。キー操作やドラッグの終わりは、画面の再描画より先に来ることがあるため、
  // state ではなくこちらを読む（state だと1つ前の値を読んでしまう）
  const sectionsRef = useRef<EditorSection[]>(initialSections);
  const draftRef = useRef<Point[]>([]);
  const [mode, setMode] = useState<Mode>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [draft, setDraftState] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  /** ドラッグ中の頂点（表示には使わないので ref で持つ） */
  const dragRef = useRef<Drag | null>(null);
  const numberInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [scalePercent, setScalePercent] = useState(100);
  /** 画面のピクセル ÷ 画像のピクセル（ハンドルの大きさの計算に使う） */
  const [pxPerUnit, setPxPerUnit] = useState(1);
  const [fitSize, setFitSize] = useState<{ width: number; height: number } | null>(null);

  const selected = sections.find((s) => s.id === selectedId) ?? null;

  function updateSections(update: (prev: EditorSection[]) => EditorSection[]) {
    sectionsRef.current = update(sectionsRef.current);
    setSections(sectionsRef.current);
  }

  function setDraft(update: Point[] | ((prev: Point[]) => Point[])) {
    draftRef.current = typeof update === "function" ? update(draftRef.current) : update;
    setDraftState(draftRef.current);
  }

  // ---- 表示の大きさ ---------------------------------------------------------

  const measure = useCallback(() => {
    const ctm = svgRef.current?.getScreenCTM();
    if (ctm && ctm.a > 0) setPxPerUnit(ctm.a);
  }, []);

  // 図面を枠いっぱいに収める大きさ（拡大率 100% のとき）
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const scale = Math.min(width / image.width, height / image.height);
      setFitSize({ width: image.width * scale, height: image.height * scale });
      requestAnimationFrame(measure);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [image.width, image.height, measure]);

  const unit = (px: number) => px / pxPerUnit;

  // ---- 座標の変換 -----------------------------------------------------------

  function toImagePoint(clientX: number, clientY: number): Point | null {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [Math.min(image.width, Math.max(0, p.x)), Math.min(image.height, Math.max(0, p.y))];
  }

  // ---- 保存 -----------------------------------------------------------------

  async function savePoints(sectionId: string, points: Point[]) {
    setStatus({ kind: "saving" });
    const result = await updateSectionPoints(sectionId, points);
    if (result.ok) {
      savedPoints.current.set(sectionId, result.points);
      updateSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, points: result.points } : s)));
      setStatus({ kind: "saved" });
    } else {
      const previous = savedPoints.current.get(sectionId);
      if (previous) updateSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, points: previous } : s)));
      setStatus({ kind: "error", error: result.error });
    }
  }

  function setSectionPoints(sectionId: string, update: (points: Point[]) => Point[]) {
    updateSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, points: update(s.points) } : s)));
  }

  // ---- 描画モード -----------------------------------------------------------

  async function finishDraft() {
    const points = draftRef.current;
    if (points.length < POLYGON_LIMITS.minPoints) {
      setStatus({ kind: "error", error: "tooFewPoints" });
      return;
    }
    setDraft([]);
    setStatus({ kind: "saving" });
    const result = await createSection(floorId, points);
    if (!result.ok) {
      setDraft(points);
      setStatus({ kind: "error", error: result.error });
      return;
    }
    savedPoints.current.set(result.id, result.points);
    updateSections((prev) => [...prev, { id: result.id, number: null, points: result.points, source: "manual", hasShop: false }]);
    setSelectedId(result.id);
    setSelectedVertex(null);
    setStatus({ kind: "saved" });
    // 描いた直後に区画番号を入力できるようにする
    requestAnimationFrame(() => numberInputRef.current?.focus());
  }

  function cancelDraft() {
    setDraft([]);
    setCursor(null);
  }

  // ---- 削除 -----------------------------------------------------------------

  async function removeVertex(sectionId: string, index: number) {
    const section = sectionsRef.current.find((s) => s.id === sectionId);
    if (!section || section.points.length <= POLYGON_LIMITS.minPoints) {
      setStatus({ kind: "error", error: "tooFewPoints" });
      return;
    }
    const points = section.points.filter((_, i) => i !== index);
    setSectionPoints(sectionId, () => points);
    setSelectedVertex(null);
    await savePoints(sectionId, points);
  }

  async function removeSection(section: EditorSection) {
    const name = section.number ?? t("unnumbered");
    const message = section.hasShop
      ? t("confirmDeleteSectionWithShop", { name })
      : t("confirmDeleteSection", { name });
    if (!window.confirm(message)) return;
    setStatus({ kind: "saving" });
    const result = await deleteSection(section.id);
    if (!result.ok) {
      setStatus({ kind: "error", error: result.error });
      return;
    }
    savedPoints.current.delete(section.id);
    updateSections((prev) => prev.filter((s) => s.id !== section.id));
    setSelectedId(null);
    setSelectedVertex(null);
    setStatus({ kind: "saved" });
  }

  // ---- キーボード -----------------------------------------------------------

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;

      if (mode === "draw") {
        if (event.key === "Escape") cancelDraft();
        else if (event.key === "Enter") void finishDraft();
        else if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          setDraft((prev) => prev.slice(0, -1));
        }
        return;
      }
      if (event.key === "Escape") {
        setSelectedId(null);
        setSelectedVertex(null);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selected) {
        event.preventDefault();
        if (selectedVertex !== null) void removeVertex(selected.id, selectedVertex);
        else void removeSection(selected);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // ---- 図面上のポインター操作 -------------------------------------------------

  function onSvgPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    pointerDownAt.current = { x: event.clientX, y: event.clientY };
  }

  function wasDragged(clientX: number, clientY: number): boolean {
    const start = pointerDownAt.current;
    return !!start && Math.hypot(clientX - start.x, clientY - start.y) > CLICK_TOLERANCE_PX;
  }

  function onSvgClick(event: React.MouseEvent<SVGSVGElement>) {
    if (wasDragged(event.clientX, event.clientY)) return; // 図面を動かしたときはクリックとみなさない
    if (mode === "select") {
      setSelectedId(null);
      setSelectedVertex(null);
      return;
    }
    const point = toImagePoint(event.clientX, event.clientY);
    if (!point) return;
    // 最初の点の近くをクリックしたら確定
    const current = draftRef.current;
    if (current.length >= POLYGON_LIMITS.minPoints) {
      const [fx, fy] = current[0];
      if (Math.hypot(point[0] - fx, point[1] - fy) * pxPerUnit <= CLOSE_DISTANCE_PX) {
        void finishDraft();
        return;
      }
    }
    if (current.length < POLYGON_LIMITS.maxPoints) setDraft((prev) => [...prev, point]);
  }

  function onSvgPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (mode === "draw" && draft.length > 0) setCursor(toImagePoint(event.clientX, event.clientY));
  }

  // 頂点のドラッグ（ポインターをつかんで、図面の移動と区別する）
  function startVertexDrag(event: ReactPointerEvent<SVGElement>, sectionId: string, index: number) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedVertex(index);
    dragRef.current = { sectionId, index, moved: false };
  }

  function onVertexPointerMove(event: ReactPointerEvent<SVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = toImagePoint(event.clientX, event.clientY);
    if (!point) return;
    setSectionPoints(drag.sectionId, (points) => points.map((p, i) => (i === drag.index ? point : p)));
    drag.moved = true;
  }

  function endVertexDrag(event: ReactPointerEvent<SVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const section = sectionsRef.current.find((s) => s.id === drag.sectionId);
    if (drag.moved && section) void savePoints(section.id, section.points);
    dragRef.current = null;
  }

  // 辺の中点をつかむと、そこに頂点を追加してそのままドラッグする
  function startMidpointDrag(event: ReactPointerEvent<SVGElement>, section: EditorSection, index: number) {
    if (section.points.length >= POLYGON_LIMITS.maxPoints) return;
    const a = section.points[index];
    const b = section.points[(index + 1) % section.points.length];
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    setSectionPoints(section.id, (points) => [...points.slice(0, index + 1), mid, ...points.slice(index + 1)]);
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedVertex(index + 1);
    // 追加しただけでも形は変わるので moved=true として保存する
    dragRef.current = { sectionId: section.id, index: index + 1, moved: true };
  }

  // ---- 表示用の値 -----------------------------------------------------------

  const counts = useMemo(() => {
    let unnumbered = 0;
    let invalid = 0;
    for (const s of sections) {
      const review = needsReview(s);
      if (review === "unnumbered") unnumbered += 1;
      if (review === "invalid") invalid += 1;
    }
    return { total: sections.length, unnumbered, invalid };
  }, [sections]);

  const reviewList = sections
    .map((s) => ({ section: s, review: needsReview(s) }))
    .filter((r): r is { section: EditorSection; review: "unnumbered" | "invalid" } => r.review !== null);

  const toPath = (points: Point[]) => points.map(([x, y]) => `${x},${y}`).join(" ");

  const statusMessage =
    status.kind === "saving"
      ? { text: t("saving"), className: "text-text-sub" }
      : status.kind === "saved"
        ? { text: t("saved"), className: "text-success-text" }
        : status.kind === "error"
          ? { text: t(`errors.${status.error}`), className: "text-error-text" }
          : null;

  const toolButton = (active: boolean) =>
    `h-11 rounded-xl px-4 text-sm font-bold ${active ? "bg-primary text-white" : "border border-line bg-surface hover:bg-bg"}`;
  const iconButton = "flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-lg hover:bg-bg";

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-3">
        {/* ツールバー */}
        <div role="toolbar" aria-label={t("toolbar")} className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-xl bg-bg p-1">
            <button
              type="button"
              aria-pressed={mode === "select"}
              onClick={() => {
                setMode("select");
                cancelDraft();
              }}
              className={toolButton(mode === "select")}
            >
              {t("modeSelect")}
            </button>
            <button
              type="button"
              aria-pressed={mode === "draw"}
              onClick={() => {
                setMode("draw");
                setSelectedVertex(null);
              }}
              className={toolButton(mode === "draw")}
            >
              {t("modeDraw")}
            </button>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" aria-label={t("zoomOut")} onClick={() => transformRef.current?.zoomOut()} className={iconButton}>
              −
            </button>
            <span className="w-14 text-center text-sm tabular-nums text-text-sub">{t("zoomLevel", { percent: scalePercent })}</span>
            <button type="button" aria-label={t("zoomIn")} onClick={() => transformRef.current?.zoomIn()} className={iconButton}>
              ＋
            </button>
            <button
              type="button"
              onClick={() => transformRef.current?.resetTransform()}
              className="h-11 rounded-xl border border-line bg-surface px-3 text-sm hover:bg-bg"
            >
              {t("zoomFit")}
            </button>
          </div>
        </div>

        {/* 図面 */}
        <div ref={viewportRef} className="h-[65vh] min-h-[420px] overflow-hidden rounded-xl border border-line bg-bg">
          {fitSize && (
            <TransformWrapper
              ref={transformRef}
              minScale={0.5}
              maxScale={10}
              centerOnInit
              doubleClick={{ disabled: true }}
              panning={{ excluded: [NO_PAN], velocityDisabled: true }}
              onTransform={(_, state) => {
                setScalePercent(Math.round(state.scale * 100));
                requestAnimationFrame(measure);
              }}
            >
              <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
                <svg
                  ref={svgRef}
                  width={fitSize.width}
                  height={fitSize.height}
                  viewBox={`0 0 ${image.width} ${image.height}`}
                  onPointerDown={onSvgPointerDown}
                  onPointerMove={onSvgPointerMove}
                  onClick={onSvgClick}
                  className={mode === "draw" ? "cursor-crosshair" : "cursor-grab"}
                >
                  <image href={image.url} width={image.width} height={image.height} preserveAspectRatio="none" />

                  {sections.map((section) => {
                    const isSelected = section.id === selectedId;
                    const unnumbered = !section.number || !section.hasShop;
                    const [lx, ly] = polygonCentroid(section.points);
                    return (
                      <g key={section.id}>
                        <polygon
                          points={toPath(section.points)}
                          vectorEffect="non-scaling-stroke"
                          strokeWidth={isSelected ? 3 : unnumbered ? 2 : 1.5}
                          strokeDasharray={!isSelected && unnumbered ? "6 4" : undefined}
                          strokeLinejoin="round"
                          className={`${
                            isSelected
                              ? "fill-selected-bg/70 stroke-primary"
                              : unnumbered
                                ? "fill-warning-bg-light/70 stroke-warning-line-strong"
                                : "fill-surface/70 stroke-text-sub"
                          } ${mode === "select" ? "cursor-pointer" : ""}`}
                          onClick={(event) => {
                            if (mode !== "select" || wasDragged(event.clientX, event.clientY)) return;
                            event.stopPropagation();
                            setSelectedId(section.id);
                            setSelectedVertex(null);
                          }}
                        />
                        <text
                          x={lx}
                          y={ly}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={unit(LABEL_SIZE_PX)}
                          className={`pointer-events-none select-none font-bold ${
                            section.number ? "fill-text" : "fill-warning-text"
                          }`}
                        >
                          {section.number ?? t("unnumbered")}
                        </text>
                      </g>
                    );
                  })}

                  {/* 選択中の区画の頂点と、辺の中点 */}
                  {mode === "select" && selected && (
                    <g>
                      {selected.points.map((a, i) => {
                        const b = selected.points[(i + 1) % selected.points.length];
                        return (
                          <circle
                            key={`mid-${i}`}
                            cx={(a[0] + b[0]) / 2}
                            cy={(a[1] + b[1]) / 2}
                            r={unit(MIDPOINT_RADIUS_PX)}
                            className={`${NO_PAN} cursor-copy fill-surface stroke-primary`}
                            vectorEffect="non-scaling-stroke"
                            strokeWidth={1.5}
                            onPointerDown={(event) => startMidpointDrag(event, selected, i)}
                            onPointerMove={onVertexPointerMove}
                            onPointerUp={endVertexDrag}
                            onClick={(event) => event.stopPropagation()}
                          />
                        );
                      })}
                      {selected.points.map(([x, y], i) => (
                        <circle
                          key={`v-${i}`}
                          cx={x}
                          cy={y}
                          r={unit(HANDLE_RADIUS_PX)}
                          className={`${NO_PAN} cursor-move ${
                            selectedVertex === i ? "fill-primary stroke-surface" : "fill-surface stroke-primary"
                          }`}
                          vectorEffect="non-scaling-stroke"
                          strokeWidth={2}
                          onPointerDown={(event) => startVertexDrag(event, selected.id, i)}
                          onPointerMove={onVertexPointerMove}
                          onPointerUp={endVertexDrag}
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            void removeVertex(selected.id, i);
                          }}
                        />
                      ))}
                    </g>
                  )}

                  {/* 描いている途中の区画 */}
                  {mode === "draw" && draft.length > 0 && (
                    <g className="pointer-events-none">
                      <polyline
                        points={toPath(cursor ? [...draft, cursor] : draft)}
                        fill="none"
                        vectorEffect="non-scaling-stroke"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        className="stroke-primary"
                      />
                      {draft.map(([x, y], i) => (
                        <circle
                          key={i}
                          cx={x}
                          cy={y}
                          r={unit(i === 0 && draft.length >= POLYGON_LIMITS.minPoints ? CLOSE_DISTANCE_PX / 1.5 : 4)}
                          vectorEffect="non-scaling-stroke"
                          strokeWidth={2}
                          className={i === 0 ? "fill-surface stroke-primary" : "fill-primary"}
                        />
                      ))}
                    </g>
                  )}
                </svg>
              </TransformComponent>
            </TransformWrapper>
          )}
        </div>

        {/* 件数と保存状態 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>{t("countSections", { count: counts.total })}</span>
          <span className={counts.unnumbered > 0 ? "text-warning-text" : "text-text-sub"}>
            {t("countUnnumbered", { count: counts.unnumbered })}
          </span>
          <span className={counts.invalid > 0 ? "text-warning-text" : "text-text-sub"}>
            {t("countInvalid", { count: counts.invalid })}
          </span>
          {mode === "draw" && draft.length > 0 && (
            <span className="text-primary-text">{t("drawingHint", { count: draft.length })}</span>
          )}
          {statusMessage && (
            <span role={status.kind === "error" ? "alert" : "status"} className={`ml-auto ${statusMessage.className}`}>
              {statusMessage.text}
            </span>
          )}
        </div>
      </div>

      {/* 右列：選択中の区画・確認が必要な区画・操作方法 */}
      <aside className="space-y-4">
        {selected ? (
          <section className="space-y-3 rounded-2xl border border-primary bg-surface p-4">
            <h3 className="font-bold">{t("selectedTitle")}</h3>
            <SectionNumberField
              key={selected.id}
              inputRef={numberInputRef}
              section={selected}
              onSaved={(number) => {
                updateSections((prev) => prev.map((s) => (s.id === selected.id ? { ...s, number } : s)));
                setStatus({ kind: "saved" });
              }}
            />
            <div className="flex justify-between gap-2 text-sm text-text-sub">
              <span>{t("vertexCount", { count: selected.points.length })}</span>
              <span>{selected.source === "ai" ? t("sourceAi") : t("sourceManual")}</span>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={selectedVertex === null || selected.points.length <= POLYGON_LIMITS.minPoints}
                onClick={() => selectedVertex !== null && void removeVertex(selected.id, selectedVertex)}
                className="h-11 rounded-xl border border-line text-sm hover:bg-bg disabled:opacity-50"
              >
                {t("deleteVertex")}
              </button>
              <button
                type="button"
                onClick={() => void removeSection(selected)}
                className="h-11 rounded-xl border border-error-line bg-error-bg text-sm font-bold text-error-text hover:opacity-80"
              >
                {t("deleteSection")}
              </button>
            </div>
          </section>
        ) : null}

        <section className="space-y-2 rounded-2xl border border-line bg-surface p-4">
          <h3 className="font-bold">{t("needsReviewTitle")}</h3>
          {reviewList.length === 0 ? (
            <p className="text-sm text-text-sub">{t("needsReviewEmpty")}</p>
          ) : (
            <ul className="max-h-60 space-y-1 overflow-auto">
              {reviewList.map(({ section, review }) => (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("select");
                      cancelDraft();
                      setSelectedId(section.id);
                      setSelectedVertex(null);
                    }}
                    className={`flex h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm ${
                      section.id === selectedId ? "bg-selected-bg text-primary-text" : "hover:bg-bg"
                    }`}
                  >
                    <span className="font-mono">{section.number ?? "—"}</span>
                    <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs text-warning-text">
                      {review === "unnumbered" ? t("reviewUnnumbered") : t("reviewInvalid")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-sm">
          <h3 className="font-bold">{t("helpTitle")}</h3>
          <ul className="list-disc space-y-1 pl-5 text-text-sub">
            <li>{t("help.draw")}</li>
            <li>{t("help.select")}</li>
            <li>{t("help.moveVertex")}</li>
            <li>{t("help.addVertex")}</li>
            <li>{t("help.deleteVertex")}</li>
            <li>{t("help.zoom")}</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

// ---- 区画番号の入力（工程 2-4） ------------------------------------------------

function SectionNumberField({
  section,
  inputRef,
  onSaved,
}: {
  section: EditorSection;
  inputRef: RefObject<HTMLInputElement | null>;
  onSaved: (number: string | null) => void;
}) {
  const t = useTranslations("sectionEditor");
  const [value, setValue] = useState(section.number ?? "");
  const [error, setError] = useState<SectionErrorKey | null>(null);
  const [saving, setSaving] = useState(false);

  const normalized = normalizeCode(value);
  const changed = normalized !== (section.number ?? "");
  const check = normalized ? checkSectionNumber(normalized) : null;

  async function save() {
    if (!changed || saving) return;
    setSaving(true);
    setError(null);
    const result = await updateSectionNumber(section.id, value);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setValue(result.number ?? "");
    onSaved(result.number);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="space-y-2"
    >
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("sectionNumber")}</span>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={value}
            maxLength={20}
            placeholder={t("numberPlaceholder")}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            aria-invalid={error !== null}
            className={`h-11 min-w-0 flex-1 rounded-xl border bg-surface px-3 font-mono text-base outline-none focus:ring-2 focus:ring-primary/30 ${
              error ? "border-error-text" : "border-input-line focus:border-primary"
            }`}
          />
          <button
            type="submit"
            disabled={!changed || saving}
            className="h-11 rounded-xl bg-primary px-4 text-sm font-bold text-white hover:bg-primary-text disabled:opacity-50"
          >
            {saving ? t("saving") : t("numberSave")}
          </button>
        </div>
      </label>

      {error ? (
        <p role="alert" className="rounded-xl border border-error-line bg-error-bg p-2 text-xs text-error-text">
          {t(`errors.${error}`)}
        </p>
      ) : check === null ? (
        <p className="text-xs text-warning-text">{t("unnumbered")}</p>
      ) : check.ok ? (
        <p className="rounded-xl bg-success-bg p-2 text-xs text-success-text">
          {check.floorCode.startsWith("B")
            ? t("formatOkBasement", {
                building: check.buildingCode,
                floor: check.floorCode.slice(1),
                serial: String(check.serial).padStart(2, "0"),
              })
            : t("formatOk", {
                building: check.buildingCode,
                floor: check.floorCode,
                serial: String(check.serial).padStart(2, "0"),
              })}
        </p>
      ) : (
        <p className="rounded-xl bg-warning-bg p-2 text-xs text-warning-text">{t("formatInvalid")}</p>
      )}
      <p className="text-xs text-text-sub">{t("numberHint")}</p>
    </form>
  );
}
