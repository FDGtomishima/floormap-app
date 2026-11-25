"use server";

// ジャンル管理（F-11 / 工程 4-4）：追加・名前の変更・色の設定・削除。
// 色は選択肢（src/lib/genre-colors.ts）の id で受け取り、その3色（塗り・枠・文字）を保存する
import { refresh } from "next/cache";
import { findGenrePreset } from "@/lib/genre-colors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type GenreErrorKey = "invalidName" | "invalidColor" | "duplicateName" | "notFound" | "unknown";
export type GenreResult = { ok: true } | { ok: false; error: GenreErrorKey };

const MAX_NAME = 50;

function readName(value: string): string | null {
  const name = value.trim();
  return name.length >= 1 && name.length <= MAX_NAME ? name : null;
}

function fail(error: { code?: string } | null): GenreResult {
  if (error?.code === "23505") return { ok: false, error: "duplicateName" };
  if (error) console.error("genre action failed", error);
  return { ok: false, error: "unknown" };
}

export async function addGenre(mapId: string, nameInput: string, presetId: string): Promise<GenreResult> {
  const name = readName(nameInput);
  if (!name) return { ok: false, error: "invalidName" };
  const preset = findGenrePreset(presetId);
  if (!preset) return { ok: false, error: "invalidColor" };

  const supabase = await createSupabaseServerClient();
  const { data: last } = await supabase
    .from("genres")
    .select("sort_order")
    .eq("map_id", mapId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("genres").insert({
    map_id: mapId,
    name,
    fill_color: preset.fill,
    line_color: preset.line,
    text_color: preset.text,
    sort_order: (last?.sort_order ?? 0) + 1,
  });
  if (error) return fail(error);
  refresh();
  return { ok: true };
}

/** 名前と色を変える。presetId が null なら色は変えない（選択肢にない色のまま残す） */
export async function updateGenre(mapId: string, genreId: string, nameInput: string, presetId: string | null): Promise<GenreResult> {
  const name = readName(nameInput);
  if (!name) return { ok: false, error: "invalidName" };
  const preset = presetId ? findGenrePreset(presetId) : undefined;
  if (presetId && !preset) return { ok: false, error: "invalidColor" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("genres")
    .update(preset ? { name, fill_color: preset.fill, line_color: preset.line, text_color: preset.text } : { name })
    .eq("id", genreId)
    .eq("map_id", mapId)
    .select("id");
  if (error) return fail(error);
  if (!data || data.length === 0) return { ok: false, error: "notFound" };
  refresh();
  return { ok: true };
}

/** ジャンルを削除する。このジャンルの店舗は「未分類」になる（確認は画面側で行う） */
export async function deleteGenre(mapId: string, genreId: string): Promise<GenreResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("genres").delete().eq("id", genreId).eq("map_id", mapId).select("id");
  if (error) return fail(error);
  if (!data || data.length === 0) return { ok: false, error: "notFound" };
  refresh();
  return { ok: true };
}
