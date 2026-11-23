"use client";

// フロア画像の読み込み（F-04）：選択 → ブラウザで縮小・圧縮 → 上限確認 → Storage に保存 → フロアに設定
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { FLOOR_IMAGE, MAP_IMAGES_BUCKET } from "@/lib/floor-image-config";
import { FloorImageError, processFloorImage, validateFloorImageFile } from "@/lib/floor-image-process";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { commitFloorImage, prepareFloorImageUpload, type FloorImageActionErrorKey } from "./image-actions";

type ErrorKey = FloorImageActionErrorKey | "unsupportedType" | "tooLarge" | "decodeFailed" | "uploadFailed";
type Status = { kind: "idle" } | { kind: "processing" } | { kind: "uploading" } | { kind: "done" } | { kind: "error"; error: ErrorKey };

const maxMb = Math.round(FLOOR_IMAGE.maxInputBytes / 1024 / 1024);

export function FloorImageUploader({
  floorId,
  hasImage,
  sectionCount,
}: {
  floorId: string;
  hasImage: boolean;
  sectionCount: number;
}) {
  const t = useTranslations("mapEditor");
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const busy = status.kind === "processing" || status.kind === "uploading";

  async function upload(file: File) {
    const invalid = validateFloorImageFile(file);
    if (invalid) {
      setStatus({ kind: "error", error: invalid });
      return;
    }
    if (hasImage && sectionCount > 0 && !window.confirm(t("confirmReplace", { sections: sectionCount }))) return;

    try {
      setStatus({ kind: "processing" });
      const { edit, display } = await processFloorImage(file);

      setStatus({ kind: "uploading" });
      const prepared = await prepareFloorImageUpload(floorId, edit.blob.size + display.blob.size);
      if (!prepared.ok) {
        setStatus({ kind: "error", error: prepared.error });
        return;
      }

      const id = crypto.randomUUID();
      const editPath = `${prepared.folder}/${id}-edit.${edit.extension}`;
      const displayPath = `${prepared.folder}/${id}-display.${display.extension}`;
      const bucket = createSupabaseBrowserClient().storage.from(MAP_IMAGES_BUCKET);
      const results = await Promise.all([
        bucket.upload(editPath, edit.blob, { contentType: edit.blob.type, cacheControl: "31536000" }),
        bucket.upload(displayPath, display.blob, { contentType: display.blob.type, cacheControl: "31536000" }),
      ]);
      if (results.some((r) => r.error)) {
        await bucket.remove([editPath, displayPath]);
        setStatus({ kind: "error", error: "uploadFailed" });
        return;
      }

      const committed = await commitFloorImage(floorId, displayPath, editPath, edit.width, edit.height);
      setStatus(committed.ok ? { kind: "done" } : { kind: "error", error: committed.error });
    } catch (error) {
      setStatus({ kind: "error", error: error instanceof FloorImageError ? error.key : "unknown" });
    }
  }

  function onFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) void upload(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  const message =
    status.kind === "processing"
      ? { text: t("processing"), className: "text-text-sub" }
      : status.kind === "uploading"
        ? { text: t("uploading"), className: "text-text-sub" }
        : status.kind === "done"
          ? { text: t("uploaded"), className: "text-success-text" }
          : status.kind === "error"
            ? { text: t(`imageErrors.${status.error}`, { maxMb }), className: "text-error-text" }
            : null;

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={FLOOR_IMAGE.acceptTypes.join(",")}
      className="hidden"
      onChange={(event) => onFiles(event.target.files)}
    />
  );

  if (hasImage) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {fileInput}
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="h-11 rounded-xl border border-line px-4 text-sm font-medium hover:bg-bg disabled:opacity-60"
        >
          {t("replaceImage")}
        </button>
        {message && (
          <span role={status.kind === "error" ? "alert" : "status"} className={`text-sm ${message.className}`}>
            {message.text}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!busy) onFiles(event.dataTransfer.files);
      }}
      className={`flex min-h-[360px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center ${
        dragging ? "border-primary bg-selected-bg" : "border-input-line bg-bg"
      }`}
    >
      {fileInput}
      <p className="font-medium">{t("noImage")}</p>
      <p className="text-sm text-text-sub">{t("dropHere")}</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="h-11 rounded-xl bg-primary px-5 text-sm font-bold text-white hover:bg-primary-text disabled:opacity-60"
      >
        {busy ? (status.kind === "processing" ? t("processing") : t("uploading")) : t("selectImage")}
      </button>
      <p className="text-xs text-text-sub">{t("imageConditions", { maxMb })}</p>
      {message && status.kind === "error" && (
        <p role="alert" className={`text-sm ${message.className}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
