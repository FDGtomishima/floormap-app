"use server";

// Excel 取り込みの確定登録（F-09）。画面のプレビューの結果は使わず、DB の内容で照合とチェックをやり直してから登録する
import { refresh } from "next/cache";
import { MAP_IMAGES_BUCKET } from "@/lib/floor-image-config";
import { IMPORT_LIMITS, planImport, summarize, type ImportInputRow } from "@/lib/shop-import";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ImportResult =
  | { ok: true; created: number; updated: number; skipped: number }
  | { ok: false; error: "notFound" | "tooManyRows" | "nothingToImport" | "unknown" };

function isInputRow(value: unknown): value is ImportInputRow {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.rowNumber === "number" &&
    ["sectionNumber", "name", "genre", "hours", "description", "image", "snsLinks"].every((k) => typeof v[k] === "string")
  );
}

export async function importShops(mapId: string, rows: unknown): Promise<ImportResult> {
  if (!Array.isArray(rows) || !rows.every(isInputRow)) return { ok: false, error: "unknown" };
  if (rows.length > IMPORT_LIMITS.maxRows) return { ok: false, error: "tooManyRows" };

  const supabase = await createSupabaseServerClient();
  // RLS により、本人のマップでなければ何も取れない
  const [{ data: map }, { data: sections }, { data: genres }, { data: shops }] = await Promise.all([
    supabase.from("maps").select("id").eq("id", mapId).maybeSingle(),
    supabase.from("sections").select("id, number").eq("map_id", mapId),
    supabase.from("genres").select("id, name").eq("map_id", mapId),
    supabase.from("shops").select("section_id").eq("map_id", mapId),
  ]);
  if (!map) return { ok: false, error: "notFound" };

  const plan = planImport(rows, {
    sections: sections ?? [],
    genres: genres ?? [],
    sectionIdsWithShop: (shops ?? []).map((s) => s.section_id),
  });
  const valid = plan.flatMap((r) => (r.values ? [r.values] : []));
  if (valid.length === 0) return { ok: false, error: "nothingToImport" };

  const { data, error } = await supabase.rpc("import_shops", {
    p_map_id: mapId,
    p_rows: valid.map((v) => ({
      section_id: v.sectionId,
      name: v.name,
      genre_id: v.genreId,
      hours: v.hours,
      description: v.description,
      sns_links: v.snsLinks,
    })),
  });
  if (error || !data?.[0]) {
    console.error("import_shops failed", error);
    return { ok: false, error: error?.message === "not_found" ? "notFound" : "unknown" };
  }

  refresh();
  return {
    ok: true,
    created: data[0].created_count,
    updated: data[0].updated_count,
    skipped: summarize(plan).errorCount,
  };
}

// ---- 画像の一括登録（工程 4-2） ------------------------------------------------

export type AttachImagesResult =
  | { ok: true; attached: number; failed: number }
  | { ok: false; error: "notFound" | "unknown" };

/**
 * ブラウザで Storage に保存した店舗の写真を、区画の店舗に設定する。前の写真は消す。
 * 画面から来たパスはそのまま信用せず、このマップの shops フォルダーにあるファイルかを確かめてから使う
 */
export async function attachShopImages(mapId: string, items: unknown): Promise<AttachImagesResult> {
  if (!Array.isArray(items)) return { ok: false, error: "unknown" };
  const list = items.filter(
    (i): i is { sectionId: string; path: string } =>
      !!i && typeof i === "object" && typeof (i as Record<string, unknown>).sectionId === "string" && typeof (i as Record<string, unknown>).path === "string",
  );

  const supabase = await createSupabaseServerClient();
  const { data: map } = await supabase.from("maps").select("id").eq("id", mapId).maybeSingle();
  if (!map) return { ok: false, error: "notFound" };

  const folder = `${mapId}/shops`;
  const bucket = supabase.storage.from(MAP_IMAGES_BUCKET);
  const { data: files } = await bucket.list(folder, { limit: 10000 });
  const existing = new Set((files ?? []).map((f) => `${folder}/${f.name}`));
  const pathPattern = new RegExp(`^${folder}/[0-9a-f-]+\\.(webp|jpg)$`);

  let attached = 0;
  let failed = 0;
  const toRemove: string[] = [];
  for (const item of list) {
    if (!pathPattern.test(item.path) || !existing.has(item.path)) {
      failed += 1;
      continue;
    }
    // RLS により、本人のマップの店舗だけが対象になる
    const { data: shop } = await supabase
      .from("shops")
      .select("id, image_path")
      .eq("map_id", mapId)
      .eq("section_id", item.sectionId)
      .maybeSingle();
    if (!shop) {
      failed += 1;
      toRemove.push(item.path);
      continue;
    }
    const { error } = await supabase.from("shops").update({ image_path: item.path }).eq("id", shop.id);
    if (error) {
      failed += 1;
      toRemove.push(item.path);
      continue;
    }
    attached += 1;
    if (shop.image_path && shop.image_path !== item.path && shop.image_path.startsWith(`${folder}/`)) toRemove.push(shop.image_path);
  }
  if (toRemove.length > 0) await bucket.remove(toRemove);

  refresh();
  return { ok: true, attached, failed };
}
