"use server";

// 店舗の個別編集（F-10 / 工程 4-3）：追加・変更・削除、写真の削除。
// 写真の差し替えは、ブラウザで Storage に保存してから attachShopImages（import-actions.ts）で設定する
import { refresh } from "next/cache";
import { removeShopImages } from "@/lib/floor-image-cleanup";
import { checkShopFields, type ShopFieldIssue } from "@/lib/shop-import";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SaveShopInput = {
  /** 変更のときだけ */
  shopId: string | null;
  sectionId: string;
  name: string;
  genreId: string | null;
  hours: string;
  description: string;
  /** 改行区切り */
  snsLinks: string;
};

export type SaveShopResult =
  | { ok: true; shopId: string; sectionId: string }
  | { ok: false; issues: ShopFieldIssue[] }
  | { ok: false; error: "sectionTaken" | "notFound" | "invalidGenre" | "unknown" };

export async function saveShop(mapId: string, input: SaveShopInput): Promise<SaveShopResult> {
  const { issues, values } = checkShopFields(input);
  if (issues.length > 0) return { ok: false, issues };

  const supabase = await createSupabaseServerClient();
  const fields = {
    name: values.name,
    genre_id: input.genreId || null,
    hours: values.hours,
    description: values.description,
    sns_links: values.snsLinks,
  };

  if (input.shopId) {
    // 区画は変えない（区画を変えたいときは削除して追加し直す）
    const { data, error } = await supabase
      .from("shops")
      .update(fields)
      .eq("id", input.shopId)
      .eq("map_id", mapId)
      .select("id, section_id");
    if (error) return failure(error);
    if (!data || data.length === 0) return { ok: false, error: "notFound" };
    refresh();
    return { ok: true, shopId: data[0].id, sectionId: data[0].section_id };
  }

  // 追加：区画がこのマップのものか確かめる（RLS で本人のマップの区画だけが見える）
  const { data: section } = await supabase.from("sections").select("id").eq("id", input.sectionId).eq("map_id", mapId).maybeSingle();
  if (!section) return { ok: false, error: "notFound" };
  const { data, error } = await supabase
    .from("shops")
    .insert({ section_id: section.id, ...fields })
    .select("id, section_id")
    .single();
  if (error || !data) return failure(error);
  refresh();
  return { ok: true, shopId: data.id, sectionId: data.section_id };
}

function failure(error: { code?: string } | null): SaveShopResult {
  if (error?.code === "23505") return { ok: false, error: "sectionTaken" }; // 1区画に1店舗
  if (error?.code === "23503") return { ok: false, error: "invalidGenre" }; // 別のマップのジャンル
  if (error) console.error("saveShop failed", error);
  return { ok: false, error: "unknown" };
}

export type DeleteShopResult = { ok: true } | { ok: false; error: "notFound" | "unknown" };

/** 店舗を削除する（区画は残る）。写真も消す */
export async function deleteShop(mapId: string, shopId: string): Promise<DeleteShopResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("shops").delete().eq("id", shopId).eq("map_id", mapId).select("image_path");
  if (error) {
    console.error("deleteShop failed", error);
    return { ok: false, error: "unknown" };
  }
  if (!data || data.length === 0) return { ok: false, error: "notFound" };
  await removeShopImages(supabase, mapId, data.flatMap((s) => (s.image_path ? [s.image_path] : [])));
  refresh();
  return { ok: true };
}

/** 店舗の写真を外して消す */
export async function removeShopImage(mapId: string, shopId: string): Promise<DeleteShopResult> {
  const supabase = await createSupabaseServerClient();
  const { data: shop } = await supabase.from("shops").select("image_path").eq("id", shopId).eq("map_id", mapId).maybeSingle();
  if (!shop) return { ok: false, error: "notFound" };
  const { error } = await supabase.from("shops").update({ image_path: null }).eq("id", shopId);
  if (error) return { ok: false, error: "unknown" };
  if (shop.image_path) await removeShopImages(supabase, mapId, [shop.image_path]);
  refresh();
  return { ok: true };
}
