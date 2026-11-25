import "server-only";
import { MAP_IMAGES_BUCKET } from "@/lib/floor-image-config";
import { parsePolygon, type Point } from "@/lib/polygon";
import { normalizeCode } from "@/lib/section-number";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

// 閲覧画面に渡すマップ全体のデータ。工程 5-1 ではこの形のまま map_publications.data（公開版）に保存する。
// 閲覧者に見せてよい項目だけを入れること（持ち主の情報や下書きの管理用の項目は入れない）
export type PublicGenre = {
  id: string;
  name: string;
  nameI18n: Record<string, string>;
  fillColor: string;
  lineColor: string;
  textColor: string;
};

export type PublicShop = {
  id: string;
  name: string;
  genreId: string | null;
  hours: string | null;
  description: string | null;
  imageUrl: string | null;
  snsLinks: string[];
};

export type PublicSection = { id: string; number: string | null; points: Point[]; shop: PublicShop | null };

export type PublicFloor = {
  id: string;
  code: string;
  name: string;
  image: { url: string; width: number; height: number } | null;
  sections: PublicSection[];
};

export type PublicBuilding = { id: string; code: string; name: string; floors: PublicFloor[] };

export type PublicMapData = {
  version: 1;
  name: string;
  code: string;
  genres: PublicGenre[];
  buildings: PublicBuilding[];
};

function toStringRecord(value: Json): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/** 下書きのテーブルから、閲覧用のマップ全体のデータを組み立てる */
export async function buildMapSnapshot(mapId: string): Promise<PublicMapData | null> {
  const supabase = await createSupabaseAdminClient();
  const [{ data: map }, { data: genres }, { data: buildings }, { data: floors }, { data: sections }, { data: shops }] =
    await Promise.all([
      supabase.from("maps").select("name, code").eq("id", mapId).maybeSingle(),
      supabase.from("genres").select("id, name, name_i18n, fill_color, line_color, text_color").eq("map_id", mapId).order("sort_order"),
      supabase.from("buildings").select("id, code, name").eq("map_id", mapId).order("sort_order").order("created_at"),
      supabase
        .from("floors")
        .select("id, building_id, code, name, image_path, image_width, image_height")
        .eq("map_id", mapId)
        .order("sort_order")
        .order("created_at"),
      supabase.from("sections").select("id, floor_id, number, points").eq("map_id", mapId).order("created_at"),
      supabase
        .from("shops")
        .select("id, section_id, name, genre_id, hours, description, image_path, sns_links")
        .eq("map_id", mapId),
    ]);
  if (!map) return null;

  const publicUrl = (path: string) => supabase.storage.from(MAP_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;

  const shopBySection = new Map<string, PublicShop>();
  for (const s of shops ?? []) {
    shopBySection.set(s.section_id, {
      id: s.id,
      name: s.name,
      genreId: s.genre_id,
      hours: s.hours,
      description: s.description,
      imageUrl: s.image_path ? publicUrl(s.image_path) : null,
      snsLinks: s.sns_links,
    });
  }

  const sectionsByFloor = new Map<string, PublicSection[]>();
  for (const s of sections ?? []) {
    const points = parsePolygon(s.points);
    if (!points) continue;
    const list = sectionsByFloor.get(s.floor_id) ?? [];
    list.push({ id: s.id, number: s.number, points, shop: shopBySection.get(s.id) ?? null });
    sectionsByFloor.set(s.floor_id, list);
  }

  return {
    version: 1,
    name: map.name,
    code: map.code,
    genres: (genres ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      nameI18n: toStringRecord(g.name_i18n),
      fillColor: g.fill_color,
      lineColor: g.line_color,
      textColor: g.text_color,
    })),
    buildings: (buildings ?? []).map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      floors: (floors ?? [])
        .filter((f) => f.building_id === b.id)
        .map((f) => ({
          id: f.id,
          code: f.code,
          name: f.name,
          image:
            f.image_path && f.image_width && f.image_height
              ? { url: publicUrl(f.image_path), width: f.image_width, height: f.image_height }
              : null,
          sections: sectionsByFloor.get(f.id) ?? [],
        })),
    })),
  };
}

export type ViewerMapResult = { status: "ok"; data: PublicMapData } | { status: "notFound" };

/**
 * 閲覧画面のデータを取得する（F-06）。
 * テスト版：環境変数 VIEWER_SHOW_DRAFTS=true のときだけ、下書きを組み立てて表示する。
 * 工程 5-1 で公開版（map_publications）を読む処理と、公開状態・期間の判定に置き換える
 */
export async function getViewerMap(codeInput: string): Promise<ViewerMapResult> {
  const code = normalizeCode(decodeURIComponent(codeInput));
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return { status: "notFound" };
  if (process.env.VIEWER_SHOW_DRAFTS !== "true") return { status: "notFound" };

  const supabase = await createSupabaseAdminClient();
  const { data: map } = await supabase.from("maps").select("id").eq("code", code).maybeSingle();
  if (!map) return { status: "notFound" };
  const data = await buildMapSnapshot(map.id);
  return data ? { status: "ok", data } : { status: "notFound" };
}
