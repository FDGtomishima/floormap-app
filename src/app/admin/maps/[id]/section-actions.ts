"use server";

// 区画の作成・形の変更・削除（F-05）。本人のマップ以外は RLS で拒否される。
// 区画エディタは画面側で状態を持つため、形の変更では画面の再読み込み（refresh）をしない
import { refresh } from "next/cache";
import { removeShopImages, shopImagePathsForSections } from "@/lib/floor-image-cleanup";
import { normalizePolygon, type Point } from "@/lib/polygon";
import { normalizeCode } from "@/lib/section-number";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SectionErrorKey = "invalidPolygon" | "noImage" | "notFound" | "duplicateNumber" | "numberTooLong" | "unknown";
export type SectionResult = { ok: true; id: string; points: Point[] } | { ok: false; error: SectionErrorKey };
export type DeleteSectionResult = { ok: true } | { ok: false; error: SectionErrorKey };

async function floorSize(floorId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("floors").select("image_width, image_height").eq("id", floorId).maybeSingle();
  return { supabase, floor: data };
}

export async function createSection(floorId: string, points: Point[]): Promise<SectionResult> {
  const { supabase, floor } = await floorSize(floorId);
  if (!floor) return { ok: false, error: "notFound" };
  if (!floor.image_width || !floor.image_height) return { ok: false, error: "noImage" };
  const normalized = normalizePolygon(points, floor.image_width, floor.image_height);
  if (!normalized) return { ok: false, error: "invalidPolygon" };

  const { data, error } = await supabase
    .from("sections")
    .insert({ floor_id: floorId, points: normalized, source: "manual" })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createSection failed", error);
    return { ok: false, error: "unknown" };
  }
  refresh(); // 左の一覧の区画数を更新する
  return { ok: true, id: data.id, points: normalized };
}

export async function updateSectionPoints(sectionId: string, points: Point[]): Promise<SectionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: section } = await supabase.from("sections").select("floor_id").eq("id", sectionId).maybeSingle();
  if (!section) return { ok: false, error: "notFound" };
  const { floor } = await floorSize(section.floor_id);
  if (!floor?.image_width || !floor.image_height) return { ok: false, error: "noImage" };
  const normalized = normalizePolygon(points, floor.image_width, floor.image_height);
  if (!normalized) return { ok: false, error: "invalidPolygon" };

  const { data, error } = await supabase.from("sections").update({ points: normalized }).eq("id", sectionId).select("id");
  if (error) {
    console.error("updateSectionPoints failed", error);
    return { ok: false, error: "unknown" };
  }
  if (!data || data.length === 0) return { ok: false, error: "notFound" };
  return { ok: true, id: sectionId, points: normalized };
}

export async function deleteSection(sectionId: string): Promise<DeleteSectionResult> {
  const supabase = await createSupabaseServerClient();
  // 紐づく店舗もまとめて削除される（確認は画面側で行う）。店舗の写真は先にパスを集めておく
  const shopImages = await shopImagePathsForSections(supabase, [sectionId]);
  const { data, error } = await supabase.from("sections").delete().eq("id", sectionId).select("id, map_id");
  if (error) {
    console.error("deleteSection failed", error);
    return { ok: false, error: "unknown" };
  }
  if (!data || data.length === 0) return { ok: false, error: "notFound" };
  await removeShopImages(supabase, data[0].map_id, shopImages);
  refresh();
  return { ok: true };
}

export type SectionNumberResult = { ok: true; number: string | null } | { ok: false; error: SectionErrorKey };

// 区画番号の保存（F-05 / 工程 2-4）。全角・小文字はそろえて保存し、空なら「番号未設定」にする。
// 書式（A-101 など）に合わなくても保存は可（警告は画面側）。マップ内での重複は DB の一意制約で拒否する
export async function updateSectionNumber(sectionId: string, input: string): Promise<SectionNumberResult> {
  const normalized = normalizeCode(input);
  const number = normalized === "" ? null : normalized;
  if (number && number.length > 20) return { ok: false, error: "numberTooLong" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("sections").update({ number }).eq("id", sectionId).select("id");
  if (error) {
    if (error.code === "23505") return { ok: false, error: "duplicateNumber" };
    console.error("updateSectionNumber failed", error);
    return { ok: false, error: "unknown" };
  }
  if (!data || data.length === 0) return { ok: false, error: "notFound" };
  return { ok: true, number };
}
