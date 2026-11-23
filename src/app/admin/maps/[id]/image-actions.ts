"use server";

// フロア画像のアップロード（F-04）。画像の縮小・圧縮と Storage への保存はブラウザで行い、
// ここでは上限の確認と、フロアへの設定（DB の set_floor_image）を行う
import { refresh } from "next/cache";
import { MAP_IMAGES_BUCKET } from "@/lib/floor-image-config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkUsageLimit } from "@/lib/usage-limit";

export type FloorImageActionErrorKey = "notFound" | "limitExceeded" | "invalidImage" | "imageNotFound" | "unknown";

export type PrepareResult = { ok: true; folder: string } | { ok: false; error: FloorImageActionErrorKey };
export type CommitResult = { ok: true } | { ok: false; error: FloorImageActionErrorKey };

// アップロードの前に、フロアが本人のものか・容量の上限を超えないかを確認し、保存先フォルダーを返す
export async function prepareFloorImageUpload(floorId: string, totalBytes: number): Promise<PrepareResult> {
  const supabase = await createSupabaseServerClient();
  const { data: floor } = await supabase.from("floors").select("id, map_id").eq("id", floorId).maybeSingle();
  if (!floor) return { ok: false, error: "notFound" };

  await supabase.rpc("refresh_image_usage");
  const limit = await checkUsageLimit("image", Math.max(0, Math.round(totalBytes)));
  if (!limit.allowed) return { ok: false, error: "limitExceeded" };

  return { ok: true, folder: `${floor.map_id}/floors/${floor.id}` };
}

const ERROR_MAP: Record<string, FloorImageActionErrorKey> = {
  not_found: "notFound",
  invalid_image: "invalidImage",
  image_not_found: "imageNotFound",
  limit_exceeded: "limitExceeded",
};

// Storage に保存した画像をフロアに設定し、前の画像を消す
export async function commitFloorImage(
  floorId: string,
  imagePath: string,
  editImagePath: string,
  width: number,
  height: number,
): Promise<CommitResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_floor_image", {
    p_floor_id: floorId,
    p_image_path: imagePath,
    p_edit_image_path: editImagePath,
    p_width: Math.round(width),
    p_height: Math.round(height),
  });

  if (error) {
    // 設定できなかった画像は残さない
    await supabase.storage.from(MAP_IMAGES_BUCKET).remove([imagePath, editImagePath]);
    await supabase.rpc("refresh_image_usage");
    const key = ERROR_MAP[error.message] ?? "unknown";
    if (key === "unknown") console.error("set_floor_image failed", error);
    return { ok: false, error: key };
  }

  const old = data?.[0];
  const oldPaths = [old?.old_image_path, old?.old_edit_image_path].filter((p): p is string => Boolean(p));
  if (oldPaths.length > 0) await supabase.storage.from(MAP_IMAGES_BUCKET).remove(oldPaths);
  await supabase.rpc("refresh_image_usage");

  refresh();
  return { ok: true };
}
