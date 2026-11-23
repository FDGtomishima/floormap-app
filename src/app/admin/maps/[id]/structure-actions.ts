"use server";

// 建物・フロアの追加・変更・並べ替え・削除（F-03）。
// ログイン中の管理者の権限で Supabase を呼ぶため、本人のマップ以外は RLS で拒否される
import { refresh } from "next/cache";
import { removeFloorImages } from "@/lib/floor-image-cleanup";
import { isValidBuildingCode, isValidFloorCode, normalizeCode } from "@/lib/section-number";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type StructureErrorKey =
  | "invalidBuildingCode"
  | "invalidFloorCode"
  | "invalidName"
  | "duplicateCode"
  | "lastBuilding"
  | "notFound"
  | "unknown";

export type StructureResult = { ok: true; id?: string } | { ok: false; error: StructureErrorKey };

type Direction = "up" | "down";

function readName(value: string): string | null {
  const name = value.trim();
  return name.length >= 1 && name.length <= 50 ? name : null;
}

function fail(error: { code?: string } | null): StructureResult {
  if (error?.code === "23505") return { ok: false, error: "duplicateCode" };
  if (error) console.error("structure action failed", error);
  return { ok: false, error: "unknown" };
}

// ---- 建物 ------------------------------------------------------------------

export async function addBuilding(mapId: string, codeInput: string, nameInput: string): Promise<StructureResult> {
  const code = normalizeCode(codeInput);
  if (!isValidBuildingCode(code)) return { ok: false, error: "invalidBuildingCode" };
  const name = readName(nameInput);
  if (!name) return { ok: false, error: "invalidName" };

  const supabase = await createSupabaseServerClient();
  const { data: last } = await supabase
    .from("buildings")
    .select("sort_order")
    .eq("map_id", mapId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("buildings")
    .insert({ map_id: mapId, code, name, sort_order: (last?.sort_order ?? 0) + 1 })
    .select("id")
    .single();
  if (error || !data) return fail(error);
  refresh();
  return { ok: true, id: data.id };
}

export async function updateBuilding(id: string, codeInput: string, nameInput: string): Promise<StructureResult> {
  const code = normalizeCode(codeInput);
  if (!isValidBuildingCode(code)) return { ok: false, error: "invalidBuildingCode" };
  const name = readName(nameInput);
  if (!name) return { ok: false, error: "invalidName" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("buildings").update({ code, name }).eq("id", id).select("id");
  if (error) return fail(error);
  if (!data || data.length === 0) return { ok: false, error: "notFound" };
  refresh();
  return { ok: true };
}

export async function moveBuilding(id: string, direction: Direction): Promise<StructureResult> {
  const supabase = await createSupabaseServerClient();
  const { data: target } = await supabase.from("buildings").select("map_id").eq("id", id).maybeSingle();
  if (!target) return { ok: false, error: "notFound" };

  const { data: siblings } = await supabase
    .from("buildings")
    .select("id, sort_order")
    .eq("map_id", target.map_id)
    .order("sort_order")
    .order("created_at");
  const result = await reorder("buildings", siblings ?? [], id, direction);
  if (result.ok) refresh();
  return result;
}

export async function deleteBuilding(id: string): Promise<StructureResult> {
  const supabase = await createSupabaseServerClient();
  const { data: target } = await supabase.from("buildings").select("map_id").eq("id", id).maybeSingle();
  if (!target) return { ok: false, error: "notFound" };

  // 建物は1つでも必ず1件残す（docs/01_spec.md「建物が1つでも1件作る」）
  const { count } = await supabase
    .from("buildings")
    .select("id", { count: "exact", head: true })
    .eq("map_id", target.map_id);
  if ((count ?? 0) <= 1) return { ok: false, error: "lastBuilding" };

  const { data: floors } = await supabase.from("floors").select("id").eq("building_id", id);
  const { error } = await supabase.from("buildings").delete().eq("id", id);
  if (error) return fail(error);
  await removeFloorImages(supabase, target.map_id, (floors ?? []).map((f) => f.id));
  refresh();
  return { ok: true };
}

// ---- フロア ----------------------------------------------------------------

export async function addFloor(buildingId: string, codeInput: string, nameInput: string): Promise<StructureResult> {
  const code = normalizeCode(codeInput);
  if (!isValidFloorCode(code)) return { ok: false, error: "invalidFloorCode" };
  const name = readName(nameInput);
  if (!name) return { ok: false, error: "invalidName" };

  const supabase = await createSupabaseServerClient();
  const { data: last } = await supabase
    .from("floors")
    .select("sort_order")
    .eq("building_id", buildingId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("floors")
    .insert({ building_id: buildingId, code, name, sort_order: (last?.sort_order ?? 0) + 1 })
    .select("id")
    .single();
  if (error || !data) return fail(error);
  refresh();
  return { ok: true, id: data.id };
}

export async function updateFloor(id: string, codeInput: string, nameInput: string): Promise<StructureResult> {
  const code = normalizeCode(codeInput);
  if (!isValidFloorCode(code)) return { ok: false, error: "invalidFloorCode" };
  const name = readName(nameInput);
  if (!name) return { ok: false, error: "invalidName" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("floors").update({ code, name }).eq("id", id).select("id");
  if (error) return fail(error);
  if (!data || data.length === 0) return { ok: false, error: "notFound" };
  refresh();
  return { ok: true };
}

export async function moveFloor(id: string, direction: Direction): Promise<StructureResult> {
  const supabase = await createSupabaseServerClient();
  const { data: target } = await supabase.from("floors").select("building_id").eq("id", id).maybeSingle();
  if (!target) return { ok: false, error: "notFound" };

  const { data: siblings } = await supabase
    .from("floors")
    .select("id, sort_order")
    .eq("building_id", target.building_id)
    .order("sort_order")
    .order("created_at");
  const result = await reorder("floors", siblings ?? [], id, direction);
  if (result.ok) refresh();
  return result;
}

export async function deleteFloor(id: string): Promise<StructureResult> {
  const supabase = await createSupabaseServerClient();
  // 区画・店舗もまとめて削除される（確認は画面側で行う）
  const { data, error } = await supabase.from("floors").delete().eq("id", id).select("id, map_id");
  if (error) return fail(error);
  if (!data || data.length === 0) return { ok: false, error: "notFound" };
  await removeFloorImages(supabase, data[0].map_id, [id]);
  refresh();
  return { ok: true };
}

// ---- 共通：並べ替え --------------------------------------------------------

async function reorder(
  table: "buildings" | "floors",
  siblings: { id: string; sort_order: number }[],
  id: string,
  direction: Direction,
): Promise<StructureResult> {
  const index = siblings.findIndex((s) => s.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0) return { ok: false, error: "notFound" };
  if (swapWith < 0 || swapWith >= siblings.length) return { ok: true };

  const ordered = [...siblings];
  [ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];

  // 表示順を 1, 2, 3 … に振り直す（変わった行だけ更新）
  const supabase = await createSupabaseServerClient();
  for (const [i, row] of ordered.entries()) {
    if (row.sort_order === i + 1) continue;
    const { error } = await supabase.from(table).update({ sort_order: i + 1 }).eq("id", row.id);
    if (error) return fail(error);
  }
  return { ok: true };
}
