import "server-only";
import { MAP_IMAGES_BUCKET } from "@/lib/floor-image-config";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// 削除したフロアの画像を Storage から消し、使用容量を数え直す
export async function removeFloorImages(supabase: ServerClient, mapId: string, floorIds: string[]): Promise<void> {
  const bucket = supabase.storage.from(MAP_IMAGES_BUCKET);
  for (const floorId of floorIds) {
    const folder = `${mapId}/floors/${floorId}`;
    const { data: files } = await bucket.list(folder, { limit: 1000 });
    const paths = (files ?? []).map((f) => `${folder}/${f.name}`);
    if (paths.length > 0) await bucket.remove(paths);
  }
  await supabase.rpc("refresh_image_usage");
}

// ---- 店舗の写真（工程 4-3） --------------------------------------------------
// 区画・フロア・建物を消すと店舗の行は連鎖して消えるが、Storage の写真は残るため、
// 消す前に写真のパスを集めておき、消したあとに removeShopImages で消す

/** 指定した区画の店舗の写真のパス */
export async function shopImagePathsForSections(supabase: ServerClient, sectionIds: string[]): Promise<string[]> {
  if (sectionIds.length === 0) return [];
  const { data } = await supabase.from("shops").select("image_path").in("section_id", sectionIds);
  return (data ?? []).flatMap((s) => (s.image_path ? [s.image_path] : []));
}

/** 指定したフロアにある店舗の写真のパス */
export async function shopImagePathsForFloors(supabase: ServerClient, floorIds: string[]): Promise<string[]> {
  if (floorIds.length === 0) return [];
  const { data: sections } = await supabase.from("sections").select("id").in("floor_id", floorIds);
  return shopImagePathsForSections(supabase, (sections ?? []).map((s) => s.id));
}

/** 店舗の写真を消す（そのマップの shops フォルダーのものだけ） */
export async function removeShopImages(supabase: ServerClient, mapId: string, paths: string[]): Promise<void> {
  const own = paths.filter((p) => p.startsWith(`${mapId}/shops/`));
  if (own.length > 0) await supabase.storage.from(MAP_IMAGES_BUCKET).remove(own);
}
