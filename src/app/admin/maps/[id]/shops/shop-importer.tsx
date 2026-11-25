"use client";

// Excel 取り込み（F-09）：読み込み → 区画番号で照合 → プレビュー（新規・更新・エラー）→ 確定で登録
// 工程 4-2：「画像」列のファイル名と、まとめて選んだ画像ファイルを照合し、登録のあとにアップロードして店舗に設定する
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { MAP_IMAGES_BUCKET, SHOP_IMAGE } from "@/lib/floor-image-config";
import { processShopImage, validateShopImageFile } from "@/lib/floor-image-process";
import { planImport, summarize, type ImportContext, type ImportInputRow, type ImportIssue, type ImportPlanRow } from "@/lib/shop-import";
import {
  downloadImportTemplate,
  IMPORT_ACCEPT,
  MAX_IMPORT_FILE_BYTES,
  openWorkbook,
  type WorkbookReader,
} from "@/lib/shop-import-excel";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { attachShopImages, importShops, type AttachImagesResult, type ImportResult } from "./import-actions";

type FileError =
  | { key: "unsupported" | "tooLarge" | "unreadable" | "noRows" }
  | { key: "missingColumns"; columns: string }
  | { key: "tooManyRows"; max: number };

type Preview = { fileName: string; reader: WorkbookReader; sheet: string; rows: ImportInputRow[]; plan: ImportPlanRow[] };

/** ファイル名の照合は大文字・小文字と前後の空白を区別しない */
const imageKey = (name: string) => name.trim().normalize("NFC").toLowerCase();

export function ShopImporter({ mapId, context }: { mapId: string; context: ImportContext }) {
  const t = useTranslations("shops");
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageFiles, setImageFiles] = useState<Map<string, File>>(new Map());
  const [rejectedImages, setRejectedImages] = useState<string[]>([]);
  const [imageProgress, setImageProgress] = useState<{ done: number; total: number } | null>(null);
  const [imageResult, setImageResult] = useState<AttachImagesResult | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<FileError | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function showSheet(reader: WorkbookReader, sheet: string, fileName: string) {
    const read = reader.readSheet(sheet);
    if (!read.ok) {
      setPreview({ fileName, reader, sheet, rows: [], plan: [] });
      setFileError(
        read.error === "missingColumns"
          ? { key: "missingColumns", columns: read.missing.join("・") }
          : read.error === "tooManyRows"
            ? { key: "tooManyRows", max: read.max }
            : { key: "noRows" },
      );
      return;
    }
    setFileError(null);
    setPreview({ fileName, reader, sheet, rows: read.rows, plan: planImport(read.rows, context) });
  }

  async function onFile(file: File) {
    setResult(null);
    setImageResult(null);
    setPreview(null);
    setImageFiles(new Map());
    setRejectedImages([]);
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return setFileError({ key: "unsupported" });
    if (file.size > MAX_IMPORT_FILE_BYTES) return setFileError({ key: "tooLarge" });
    setReading(true);
    try {
      const reader = await openWorkbook(file);
      if (reader.sheetNames.length === 0) return setFileError({ key: "noRows" });
      showSheet(reader, reader.sheetNames[0], file.name);
    } catch {
      setFileError({ key: "unreadable" });
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onImages(files: FileList | null) {
    const next = new Map(imageFiles);
    const rejected: string[] = [];
    for (const file of Array.from(files ?? [])) {
      if (validateShopImageFile(file)) rejected.push(file.name);
      else next.set(imageKey(file.name), file);
    }
    setImageFiles(next);
    setRejectedImages(rejected);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  /** 登録した店舗に画像をアップロードして設定する（照合できた行だけ） */
  async function uploadImages(plan: ImportPlanRow[]): Promise<AttachImagesResult | null> {
    const targets = plan.flatMap((row) => {
      const file = row.values?.imageFileName ? imageFiles.get(imageKey(row.values.imageFileName)) : undefined;
      return row.values && file ? [{ sectionId: row.values.sectionId, file }] : [];
    });
    if (targets.length === 0) return null;

    const bucket = createSupabaseBrowserClient().storage.from(MAP_IMAGES_BUCKET);
    const items: { sectionId: string; path: string }[] = [];
    let failedBeforeAttach = 0;
    setImageProgress({ done: 0, total: targets.length });
    for (const [i, target] of targets.entries()) {
      try {
        const image = await processShopImage(target.file);
        const path = `${mapId}/shops/${target.sectionId}-${crypto.randomUUID()}.${image.extension}`;
        const { error } = await bucket.upload(path, image.blob, { contentType: image.blob.type, cacheControl: "31536000" });
        if (error) failedBeforeAttach += 1;
        else items.push({ sectionId: target.sectionId, path });
      } catch {
        failedBeforeAttach += 1;
      }
      setImageProgress({ done: i + 1, total: targets.length });
    }
    setImageProgress(null);
    if (items.length === 0) return { ok: true, attached: 0, failed: failedBeforeAttach };
    const attached = await attachShopImages(mapId, items);
    return attached.ok ? { ...attached, failed: attached.failed + failedBeforeAttach } : attached;
  }

  function confirm() {
    if (!preview) return;
    const { rows, plan } = preview;
    startTransition(async () => {
      const res = await importShops(mapId, rows);
      setResult(res);
      if (!res.ok) return;
      setImageResult(await uploadImages(plan));
      setPreview(null);
      setImageFiles(new Map());
      setRejectedImages([]);
    });
  }

  function issueText(issue: ImportIssue): string {
    switch (issue.code) {
      case "tooLong":
        return t(issue.field === "name" ? "issues.tooLongName" : issue.field === "hours" ? "issues.tooLongHours" : "issues.tooLongDescription", {
          max: issue.max,
        });
      case "sectionNumberFormat":
      case "sectionNotFound":
      case "invalidLink":
      case "genreNotFound":
        return t(`issues.${issue.code}`, { value: issue.value });
      case "duplicateInFile":
        return t("issues.duplicateInFile", { value: issue.value, firstRow: issue.firstRow });
      case "tooManyLinks":
        return t("issues.tooManyLinks", { max: issue.max });
      default:
        return t(`issues.${issue.code}`);
    }
  }

  const summary = preview ? summarize(preview.plan) : null;
  const wantedImages = preview
    ? Array.from(new Set(preview.plan.flatMap((r) => (r.values?.imageFileName ? [r.values.imageFileName] : []))))
    : [];
  const matchedImages = wantedImages.filter((name) => imageFiles.has(imageKey(name)));
  const missingImages = wantedImages.filter((name) => !imageFiles.has(imageKey(name)));
  const wantedKeys = new Set(wantedImages.map(imageKey));
  const unusedImages = Array.from(imageFiles.values())
    .filter((f) => !wantedKeys.has(imageKey(f.name)))
    .map((f) => f.name);
  const registrable = summary ? summary.newCount + summary.updateCount : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void downloadImportTemplate(t("templateFile"))}
          className="h-11 px-2 text-sm text-primary-text underline"
        >
          {t("template")}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={IMPORT_ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        <button
          type="button"
          disabled={reading || pending}
          onClick={() => inputRef.current?.click()}
          className="h-11 rounded-xl bg-primary px-5 text-sm font-bold text-white hover:bg-primary-text disabled:opacity-60"
        >
          {reading ? t("reading") : t("importButton")}
        </button>
      </div>

      {fileError && (
        <p role="alert" className="rounded-xl border border-error-line bg-error-bg p-3 text-sm text-error-text">
          {fileError.key === "missingColumns"
            ? t("fileErrors.missingColumns", { columns: fileError.columns })
            : fileError.key === "tooManyRows"
              ? t("fileErrors.tooManyRows", { max: fileError.max })
              : t(`fileErrors.${fileError.key}`)}
        </p>
      )}

      {result &&
        (result.ok ? (
          <p role="status" className="rounded-xl border border-success-line bg-success-bg p-3 text-sm text-success-text">
            {t("done", { created: result.created, updated: result.updated, skipped: result.skipped })}
          </p>
        ) : (
          <p role="alert" className="rounded-xl border border-error-line bg-error-bg p-3 text-sm text-error-text">
            {t(`importErrors.${result.error}`)}
          </p>
        ))}
      {imageResult?.ok && (
        <p role="status" className={`rounded-xl border p-3 text-sm ${imageResult.failed > 0 ? "border-warning-line bg-warning-bg-light text-warning-text" : "border-success-line bg-success-bg text-success-text"}`}>
          {t("doneImages", { attached: imageResult.attached })}
          {imageResult.failed > 0 && t("doneImagesFailed", { failed: imageResult.failed })}
        </p>
      )}
      {imageProgress && (
        <p role="status" className="text-sm text-text-sub">
          {t("preview.uploadingImages", imageProgress)}
        </p>
      )}

      {preview && (
        <section className="space-y-3 rounded-2xl border border-warning-line bg-warning-bg-light p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-bold">{t("preview.title")}</h2>
            <span className="text-sm text-text-sub">{t("preview.file", { name: preview.fileName })}</span>
            {preview.reader.sheetNames.length > 1 && (
              <label className="flex items-center gap-2 text-sm">
                {t("sheet")}
                <select
                  value={preview.sheet}
                  onChange={(event) => showSheet(preview.reader, event.target.value, preview.fileName)}
                  className="h-11 rounded-xl border border-input-line bg-surface px-3"
                >
                  {preview.reader.sheetNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {summary && preview.plan.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-bold text-warning-text">
                  {t("preview.summary", { new: summary.newCount, update: summary.updateCount, error: summary.errorCount })}
                  {summary.warningCount > 0 && t("preview.warnings", { count: summary.warningCount })}
                </p>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPreview(null)}
                    className="h-11 rounded-xl border border-line bg-surface px-4 text-sm hover:bg-bg"
                  >
                    {t("preview.cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={registrable === 0 || pending}
                    onClick={confirm}
                    className="h-11 rounded-xl bg-primary px-5 text-sm font-bold text-white hover:bg-primary-text disabled:opacity-50"
                  >
                    {pending ? t("preview.registering") : t("preview.confirm", { count: registrable })}
                  </button>
                </div>
              </div>
              <p className="text-xs text-text-sub">{t("preview.note")}</p>

              {wantedImages.length > 0 && (
                <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-sm font-bold">{t("preview.imagesTitle")}</h3>
                    <input
                      ref={imageInputRef}
                      type="file"
                      multiple
                      accept={SHOP_IMAGE.acceptTypes.join(",")}
                      className="hidden"
                      onChange={(event) => onImages(event.target.files)}
                    />
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => imageInputRef.current?.click()}
                      className="h-11 rounded-xl border border-primary px-4 text-sm font-bold text-primary-text hover:bg-selected-bg disabled:opacity-50"
                    >
                      {t("preview.chooseImages")}
                    </button>
                    <span className={`text-sm font-bold ${missingImages.length > 0 ? "text-warning-text" : "text-success-text"}`}>
                      {t("preview.imagesMatched", { matched: matchedImages.length, total: wantedImages.length })}
                    </span>
                  </div>
                  <p className="text-xs text-text-sub">{t("preview.imagesHelp")}</p>
                  {missingImages.length > 0 && (
                    <p className="text-xs text-warning-text">{t("preview.imagesMissingList", { names: missingImages.join("、") })}</p>
                  )}
                  {unusedImages.length > 0 && (
                    <p className="text-xs text-text-sub">{t("preview.imagesUnused", { names: unusedImages.join("、") })}</p>
                  )}
                  {rejectedImages.length > 0 && (
                    <p className="text-xs text-error-text">{t("preview.imagesRejected", { names: rejectedImages.join("、") })}</p>
                  )}
                </div>
              )}

              <div className="max-h-[50vh] overflow-auto rounded-xl border border-line bg-surface">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-bg text-xs text-text-sub">
                    <tr>
                      <th className="px-3 py-2">{t("preview.row")}</th>
                      <th className="px-3 py-2">{t("columns.number")}</th>
                      <th className="px-3 py-2">{t("columns.name")}</th>
                      <th className="px-3 py-2">{t("columns.genre")}</th>
                      <th className="px-3 py-2">{t("preview.image")}</th>
                      <th className="px-3 py-2">{t("preview.status")}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {preview.plan.map((row) => (
                      <tr key={row.rowNumber} className={`border-t border-line ${row.status === "error" ? "bg-error-bg" : ""}`}>
                        <td className="px-3 py-2 text-text-sub tabular-nums">{row.rowNumber}</td>
                        <td className="px-3 py-2 font-mono">{row.sectionNumber || "—"}</td>
                        <td className="px-3 py-2">{row.name || "—"}</td>
                        <td className="px-3 py-2">{row.genreName || t("noGenre")}</td>
                        <td className="px-3 py-2 text-xs">
                          {!row.values?.imageFileName ? (
                            <span className="text-text-sub">—</span>
                          ) : imageFiles.has(imageKey(row.values.imageFileName)) ? (
                            <span className="text-success-text">✓ {row.values.imageFileName}</span>
                          ) : (
                            <span className="text-warning-text">
                              {row.values.imageFileName}（{t("preview.imageMissing")}）
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                              row.status === "error"
                                ? "bg-error-line text-error-text"
                                : row.status === "update"
                                  ? "bg-selected-bg text-primary-text"
                                  : "bg-success-bg text-success-text"
                            }`}
                          >
                            {row.status === "error" ? t("preview.statusError") : row.status === "update" ? t("preview.statusUpdate") : t("preview.statusNew")}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.errors.map((issue, i) => (
                            <p key={`e${i}`} className="text-error-text">
                              {issueText(issue)}
                            </p>
                          ))}
                          {row.warnings.map((issue, i) => (
                            <p key={`w${i}`} className="text-warning-text">
                              {issueText(issue)}
                            </p>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
