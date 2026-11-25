"use client";

// ジャンル管理（F-11 / 工程 4-4）：店舗情報タブのジャンルの一覧と、右側のパネルでの追加・名前の変更・色の設定・削除
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { GENRE_COLOR_PRESETS, nextFreePreset, presetOfColors, type GenreColorPreset } from "@/lib/genre-colors";
import { addGenre, deleteGenre, updateGenre, type GenreErrorKey } from "./genre-actions";

export type GenreItem = {
  id: string;
  name: string;
  fillColor: string;
  lineColor: string;
  textColor: string;
  /** このジャンルの店舗の数 */
  shopCount: number;
};

type Colors = { fill: string; line: string; text: string };
const colorsOf = (g: GenreItem): Colors => ({ fill: g.fillColor, line: g.lineColor, text: g.textColor });

function GenreChip({ name, colors }: { name: string; colors: Colors }) {
  return (
    <span
      className="inline-flex items-center rounded-full border-[1.5px] px-3 py-1 text-sm font-bold"
      style={{ backgroundColor: colors.fill, borderColor: colors.line, color: colors.text }}
    >
      {name}
    </span>
  );
}

export function GenreManager({ mapId, genres }: { mapId: string; genres: GenreItem[] }) {
  const t = useTranslations("genres");
  const [open, setOpen] = useState(false);

  return (
    <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-4">
      <h3 className="mr-2 text-sm font-bold text-text-sub">{t("title")}</h3>
      {genres.map((g) => (
        <GenreChip key={g.id} name={g.name} colors={colorsOf(g)} />
      ))}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto h-11 rounded-xl border border-line px-4 text-sm font-medium hover:bg-bg"
      >
        {t("manage")}
      </button>
      {open && <GenrePanel mapId={mapId} genres={genres} onClose={() => setOpen(false)} />}
    </section>
  );
}

// ---- 右側のパネル ----------------------------------------------------------------

function GenrePanel({ mapId, genres, onClose }: { mapId: string; genres: GenreItem[]; onClose: () => void }) {
  const t = useTranslations("genres");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-20 bg-text/30" onClick={onClose} aria-hidden />
      <section role="dialog" aria-modal="true" aria-label={t("panelTitle")} className="fixed inset-y-0 right-0 z-30 flex w-full max-w-lg flex-col bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-lg font-bold">{t("panelTitle")}</h2>
          <button type="button" onClick={onClose} aria-label={t("close")} className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-text-sub hover:bg-bg">
            ×
          </button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-sm text-text-sub">{t("help")}</p>
          {notice && (
            <p role="status" className="text-sm text-success-text">
              {notice}
            </p>
          )}
          <ul className="space-y-2">
            {genres.map((g) => (
              <li key={g.id} className="rounded-xl border border-line">
                {editingId === g.id ? (
                  <GenreForm
                    mapId={mapId}
                    genre={g}
                    usedColors={genres.filter((other) => other.id !== g.id).map(colorsOf)}
                    onDone={(message) => {
                      setEditingId(null);
                      setNotice(message);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div className="flex items-center gap-3 px-3 py-2">
                    <GenreChip name={g.name} colors={colorsOf(g)} />
                    <span className="text-xs text-text-sub">{t("usage", { count: g.shopCount })}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setEditingId(g.id);
                      }}
                      className="ml-auto h-11 rounded-xl px-4 text-sm font-medium text-primary-text hover:bg-selected-bg"
                    >
                      {t("edit")}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="rounded-xl border border-dashed border-input-line">
            {editingId === "new" ? (
              <GenreForm
                mapId={mapId}
                genre={null}
                usedColors={genres.map(colorsOf)}
                onDone={(message) => {
                  setEditingId(null);
                  setNotice(message);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNotice(null);
                  setEditingId("new");
                }}
                className="h-11 w-full text-sm font-medium text-primary-text hover:bg-selected-bg"
              >
                ＋ {t("add")}
              </button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

// ---- 1つのジャンルの入力（追加・変更で共通） ----------------------------------

function GenreForm({
  mapId,
  genre,
  usedColors,
  onDone,
  onCancel,
}: {
  mapId: string;
  genre: GenreItem | null;
  /** 他のジャンルが使っている色（新しいジャンルの初期の色を、使われていないものにする） */
  usedColors: Colors[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("genres");
  const current = genre ? presetOfColors(colorsOf(genre)) : undefined;
  const [name, setName] = useState(genre?.name ?? "");
  // 選択肢にない色のジャンルは、色を選ばない限りその色のまま（null）
  const [preset, setPreset] = useState<GenreColorPreset | null>(genre ? (current ?? null) : nextFreePreset(usedColors));
  const [error, setError] = useState<GenreErrorKey | null>(null);
  const [pending, startTransition] = useTransition();

  const previewColors: Colors = preset ?? (genre ? colorsOf(genre) : GENRE_COLOR_PRESETS[0]);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = genre
        ? await updateGenre(mapId, genre.id, name, preset?.id ?? null)
        : await addGenre(mapId, name, (preset ?? GENRE_COLOR_PRESETS[0]).id);
      if (result.ok) onDone(genre ? t("saved") : t("added"));
      else setError(result.error);
    });
  }

  function remove() {
    if (!genre) return;
    const message =
      genre.shopCount > 0
        ? t("confirmDeleteUsed", { name: genre.name, count: genre.shopCount })
        : t("confirmDelete", { name: genre.name });
    if (!window.confirm(message)) return;
    startTransition(async () => {
      const result = await deleteGenre(mapId, genre.id);
      if (result.ok) onDone(t("deleted"));
      else setError(result.error);
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="space-y-3 p-3"
    >
      <label className="block space-y-1">
        <span className="text-sm font-medium">{genre ? t("name") : t("newName")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          autoFocus
          className="h-11 w-full rounded-xl border border-input-line bg-surface px-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
      </label>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t("color")}</legend>
        <div role="radiogroup" aria-label={t("color")} className="grid grid-cols-6 gap-2">
          {GENRE_COLOR_PRESETS.map((p) => {
            const selected = preset?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={p.label}
                title={p.label}
                onClick={() => setPreset(p)}
                className={`flex h-11 items-center justify-center rounded-xl border-2 ${selected ? "border-primary ring-2 ring-primary/30" : "border-transparent"}`}
              >
                <span className="h-7 w-7 rounded-full border-[1.5px]" style={{ backgroundColor: p.fill, borderColor: p.line }} />
              </button>
            );
          })}
        </div>
        {!preset && genre && <p className="text-xs text-text-sub">{t("colorOther")}</p>}
      </fieldset>

      <div className="flex items-center gap-2 text-xs text-text-sub">
        {t("preview")}
        <GenreChip name={name.trim() || "—"} colors={previewColors} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-error-text">
          {t(`errors.${error}`)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {genre && (
          <button type="button" onClick={remove} disabled={pending} className="h-11 rounded-xl px-3 text-sm text-error-text hover:bg-error-bg disabled:opacity-50">
            {t("delete")}
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onCancel} disabled={pending} className="h-11 rounded-xl border border-line px-4 text-sm hover:bg-bg">
            {t("cancel")}
          </button>
          <button type="submit" disabled={pending} className="h-11 rounded-xl bg-primary px-5 text-sm font-bold text-white hover:bg-primary-text disabled:opacity-50">
            {pending ? t("saving") : genre ? t("save") : t("add")}
          </button>
        </div>
      </div>
    </form>
  );
}
