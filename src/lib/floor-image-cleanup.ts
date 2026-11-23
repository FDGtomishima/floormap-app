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
