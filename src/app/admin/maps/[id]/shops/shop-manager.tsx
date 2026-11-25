"use client";

// 店舗の一覧と個別編集（F-10 / 工程 4-3）：一覧の「編集」と「店舗を追加」から右側のパネルで編集する
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { MAP_IMAGES_BUCKET, SHOP_IMAGE } from "@/lib/floor-image-config";
import { processShopImage, validateShopImageFile } from "@/lib/floor-image-process";
import type { ShopFieldIssue } from "@/lib/shop-import";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { attachShopImages } from "./import-actions";
import { deleteShop, removeShopImage, saveShop } from "./shop-actions";

export type ShopRowData = {
  id: string;
  sectionId: string;
  number: string | null;
  name: string;
  genreId: string | null;
  hours: string | null;
  description: string | null;
  snsLinks: string[];
  imageUrl: string | null;
};

export type GenreOption = { id: string; name: string; fillColor: string; lineColor: string; textColor: string };

type Editing = { mode: "new" } | { mode: "edit"; shop: ShopRowData } | null;

export function ShopManager({
  mapId,
  shops,
  genres,
  freeSections,
}: {
  mapId: string;
  shops: ShopRowData[];
  genres: GenreOption[];
  /** 店舗のない区画（追加のときに選ぶ） */
  freeSections: { id: string; number: string | null }[];
}) {
  const t = useTranslations("shops");
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const genreById = new Map(genres.map((g) => [g.id, g]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setEditing({ mode: "new" });
          }}
          className="h-11 rounded-xl border border-primary bg-surface px-4 text-sm font-bold text-primary-text hover:bg-selected-bg"
        >
          ＋ {t("addShop")}
        </button>
        {notice && (
          <span role="status" className="text-sm text-success-text">
            {notice}
          </span>
        )}
      </div>

      {shops.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-text-sub">{t("empty")}</p>
      ) : (
        <div className="overflow-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg text-xs text-text-sub">
              <tr>
                <th className="px-4 py-3">{t("columns.number")}</th>
                <th className="px-4 py-3">{t("columns.name")}</th>
                <th className="px-4 py-3">{t("columns.genre")}</th>
                <th className="px-4 py-3">{t("columns.hours")}</th>
                <th className="px-4 py-3">{t("columns.links")}</th>
                <th className="px-4 py-3">{t("columns.image")}</th>
                <th className="px-4 py-3 text-right">{t("columns.edit")}</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((shop) => {
                const genre = shop.genreId ? genreById.get(shop.genreId) : undefined;
                return (
                  <tr key={shop.id} className="border-t border-line">
                    <td className="px-4 py-2 font-mono">{shop.number ?? "—"}</td>
                    <td className="px-4 py-2 font-medium">{shop.name}</td>
                    <td className="px-4 py-2">
                      {genre ? (
                        <span
                          className="rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-bold"
                          style={{ backgroundColor: genre.fillColor, borderColor: genre.lineColor, color: genre.textColor }}
                        >
                          {genre.name}
                        </span>
                      ) : (
                        <span className="text-xs text-text-sub">{t("noGenre")}</span>
                      )}
                    </td>
                    <td className="max-w-48 truncate px-4 py-2 text-text-sub">{shop.hours ?? "—"}</td>
                    <td className="px-4 py-2 text-text-sub">
                      {shop.snsLinks.length > 0 ? t("linkCount", { count: shop.snsLinks.length }) : "—"}
                    </td>
                    <td className="px-4 py-2 text-text-sub">{shop.imageUrl ? t("hasImage") : "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setNotice(null);
                          setEditing({ mode: "edit", shop });
                        }}
                        className="h-11 rounded-xl px-4 text-sm font-medium text-primary-text hover:bg-selected-bg"
                      >
                        {t("edit")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ShopEditor
          key={editing.mode === "edit" ? editing.shop.id : "new"}
          mapId={mapId}
          shop={editing.mode === "edit" ? editing.shop : null}
          genres={genres}
          freeSections={freeSections}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null);
            setNotice(message);
          }}
        />
      )}
    </div>
  );
}

// ---- 編集パネル ----------------------------------------------------------------

type EditorError =
  | { kind: "issues"; issues: ShopFieldIssue[] }
  | { kind: "error"; key: "sectionRequired" | "sectionTaken" | "notFound" | "invalidGenre" | "imageFailed" | "unknown" };

function ShopEditor({
  mapId,
  shop,
  genres,
  freeSections,
  onClose,
  onDone,
}: {
  mapId: string;
  shop: ShopRowData | null;
  genres: GenreOption[];
  freeSections: { id: string; number: string | null }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("shops");
  const te = useTranslations("shops.editor");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [sectionId, setSectionId] = useState(shop?.sectionId ?? "");
  const [name, setName] = useState(shop?.name ?? "");
  const [genreId, setGenreId] = useState(shop?.genreId ?? "");
  const [hours, setHours] = useState(shop?.hours ?? "");
  const [description, setDescription] = useState(shop?.description ?? "");
  const [links, setLinks] = useState((shop?.snsLinks ?? []).join("\n"));
  const [newImage, setNewImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [error, setError] = useState<EditorError | null>(null);
  const [pending, startTransition] = useTransition();

  // Esc で閉じる。選んだ写真のプレビュー用 URL は閉じるときに解放する
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, pending]);
  useEffect(() => () => {
    if (newImage) URL.revokeObjectURL(newImage.previewUrl);
  }, [newImage]);

  function issueText(issue: ShopFieldIssue): string {
    switch (issue.code) {
      case "tooLong":
        return t(issue.field === "name" ? "issues.tooLongName" : issue.field === "hours" ? "issues.tooLongHours" : "issues.tooLongDescription", {
          max: issue.max,
        });
      case "invalidLink":
        return t("issues.invalidLink", { value: issue.value });
      case "tooManyLinks":
        return t("issues.tooManyLinks", { max: issue.max });
      default:
        return t("issues.nameMissing");
    }
  }

  function save() {
    setError(null);
    if (!sectionId) {
      setError({ kind: "error", key: "sectionRequired" });
      return;
    }
    startTransition(async () => {
      const result = await saveShop(mapId, {
        shopId: shop?.id ?? null,
        sectionId,
        name,
        genreId: genreId || null,
        hours,
        description,
        snsLinks: links,
      });
      if (!result.ok) {
        setError("issues" in result ? { kind: "issues", issues: result.issues } : { kind: "error", key: result.error });
        return;
      }

      // 写真：新しく選んだものがあれば保存して差し替え、削除が選ばれていれば外す
      if (newImage) {
        try {
          const image = await processShopImage(newImage.file);
          const path = `${mapId}/shops/${result.sectionId}-${crypto.randomUUID()}.${image.extension}`;
          const bucket = createSupabaseBrowserClient().storage.from(MAP_IMAGES_BUCKET);
          const upload = await bucket.upload(path, image.blob, { contentType: image.blob.type, cacheControl: "31536000" });
          const attached = upload.error ? null : await attachShopImages(mapId, [{ sectionId: result.sectionId, path }]);
          if (!attached?.ok || attached.attached !== 1) {
            setError({ kind: "error", key: "imageFailed" });
            return;
          }
        } catch {
          setError({ kind: "error", key: "imageFailed" });
          return;
        }
      } else if (removeImage && shop) {
        await removeShopImage(mapId, shop.id);
      }
      onDone(te("saved"));
    });
  }

  function remove() {
    if (!shop || !window.confirm(te("confirmDelete", { name: shop.name }))) return;
    startTransition(async () => {
      const result = await deleteShop(mapId, shop.id);
      if (!result.ok) setError({ kind: "error", key: result.error });
      else onDone(te("deleted"));
    });
  }

  const currentImage = newImage?.previewUrl ?? (removeImage ? null : shop?.imageUrl ?? null);
  const fieldClass =
    "w-full rounded-xl border border-input-line bg-surface px-3 py-2.5 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";
  const label = "block space-y-1";
  const labelText = "text-sm font-medium";

  return (
    <>
      <div className="fixed inset-0 z-20 bg-text/30" onClick={() => !pending && onClose()} aria-hidden />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={shop ? te("titleEdit") : te("titleNew")}
        className="fixed inset-y-0 right-0 z-30 flex w-full max-w-lg flex-col bg-surface shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-lg font-bold">{shop ? te("titleEdit") : te("titleNew")}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label={te("close")}
            className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-text-sub hover:bg-bg"
          >
            ×
          </button>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="flex-1 space-y-4 overflow-y-auto px-5 py-4"
        >
          <label className={label}>
            <span className={labelText}>{te("section")}</span>
            {shop ? (
              <>
                <p className="font-mono text-base font-bold">{shop.number ?? "—"}</p>
                <span className="block text-xs text-text-sub">{te("sectionFixed")}</span>
              </>
            ) : freeSections.length === 0 ? (
              <p className="text-sm text-warning-text">{te("noFreeSections")}</p>
            ) : (
              <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={`${fieldClass} h-11 py-0`} autoFocus>
                <option value="">{te("sectionPlaceholder")}</option>
                {freeSections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number ?? "—"}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label className={label}>
            <span className={labelText}>
              {te("name")} <span className="text-xs text-error-text">{te("required")}</span>
            </span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={`${fieldClass} h-11`} autoFocus={!!shop} />
          </label>

          <label className={label}>
            <span className={labelText}>{te("genre")}</span>
            <select value={genreId} onChange={(e) => setGenreId(e.target.value)} className={`${fieldClass} h-11 py-0`}>
              <option value="">{t("noGenre")}</option>
              {genres.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>

          <label className={label}>
            <span className={labelText}>{te("hours")}</span>
            <textarea value={hours} onChange={(e) => setHours(e.target.value)} rows={2} className={fieldClass} />
          </label>

          <label className={label}>
            <span className={labelText}>{te("description")}</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className={fieldClass} />
          </label>

          <label className={label}>
            <span className={labelText}>{te("links")}</span>
            <textarea
              value={links}
              onChange={(e) => setLinks(e.target.value)}
              rows={3}
              placeholder="https://instagram.com/…"
              className={`${fieldClass} font-mono text-sm`}
            />
            <span className="block text-xs text-text-sub">{te("linksHint")}</span>
          </label>

          <div className="space-y-2">
            <span className={labelText}>{te("image")}</span>
            {currentImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentImage} alt="" className="aspect-[16/9] w-full rounded-xl border border-line object-cover" />
            ) : (
              <p className="rounded-xl border border-dashed border-input-line bg-bg p-4 text-center text-sm text-text-sub">
                {removeImage ? te("imageWillBeRemoved") : te("noImage")}
              </p>
            )}
            <input
              ref={imageInputRef}
              type="file"
              accept={SHOP_IMAGE.acceptTypes.join(",")}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (imageInputRef.current) imageInputRef.current.value = "";
                if (!file) return;
                if (validateShopImageFile(file)) {
                  setImageError(t("preview.imagesRejected", { names: file.name }));
                  return;
                }
                setImageError(null);
                setRemoveImage(false);
                setNewImage({ file, previewUrl: URL.createObjectURL(file) });
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="h-11 rounded-xl border border-line px-4 text-sm hover:bg-bg"
              >
                {te("chooseImage")}
              </button>
              {(newImage || (shop?.imageUrl && !removeImage)) && (
                <button
                  type="button"
                  onClick={() => {
                    setNewImage(null);
                    setRemoveImage(!!shop?.imageUrl);
                  }}
                  className="h-11 rounded-xl border border-line px-4 text-sm text-error-text hover:bg-error-bg"
                >
                  {te("removeImage")}
                </button>
              )}
              {removeImage && (
                <button type="button" onClick={() => setRemoveImage(false)} className="h-11 rounded-xl px-4 text-sm text-primary-text underline">
                  {te("undoRemoveImage")}
                </button>
              )}
            </div>
            <span className="block text-xs text-text-sub">{te("imageHint")}</span>
            {imageError && <p className="text-xs text-error-text">{imageError}</p>}
          </div>

          {error && (
            <div role="alert" className="space-y-1 rounded-xl border border-error-line bg-error-bg p-3 text-sm text-error-text">
              {error.kind === "issues" ? error.issues.map((issue, i) => <p key={i}>{issueText(issue)}</p>) : <p>{te(`errors.${error.key}`)}</p>}
            </div>
          )}

          {/* Enter で保存できるように、フォームの中に送信ボタンを置く（見た目は下のフッター） */}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>

        <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          {shop && (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="h-11 rounded-xl px-3 text-sm text-error-text hover:bg-error-bg disabled:opacity-50"
            >
              {te("delete")}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} disabled={pending} className="h-11 rounded-xl border border-line px-4 text-sm hover:bg-bg">
              {te("cancel")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending || (!shop && freeSections.length === 0)}
              className="h-11 rounded-xl bg-primary px-6 text-sm font-bold text-white hover:bg-primary-text disabled:opacity-50"
            >
              {pending ? te("saving") : te("save")}
            </button>
          </div>
        </footer>
      </section>
    </>
  );
}
