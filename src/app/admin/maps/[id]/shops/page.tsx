import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MAP_IMAGES_BUCKET } from "@/lib/floor-image-config";
import { normalizeCode } from "@/lib/section-number";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GenreManager } from "./genre-manager";
import { ShopImporter } from "./shop-importer";
import { ShopManager, type ShopRowData } from "./shop-manager";

export const metadata: Metadata = { title: "店舗情報 | フロアマップ" };

// 店舗情報管理（F-09 / F-10）：一覧、Excel 取り込み（画像の一括登録を含む）、個別編集
export default function ShopsPage({ params }: PageProps<"/admin/maps/[id]/shops">) {
  return (
    <Suspense fallback={<p className="text-sm text-text-sub">…</p>}>
      <Shops params={params} />
    </Suspense>
  );
}

async function Shops({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  // 本人のマップでなければ RLS で空になる（マップの存在確認はレイアウトで済んでいる）
  const [t, { data: sections }, { data: genres }, { data: shops }] = await Promise.all([
    getTranslations("shops"),
    supabase.from("sections").select("id, number").eq("map_id", id),
    supabase.from("genres").select("id, name, fill_color, line_color, text_color").eq("map_id", id).order("sort_order"),
    supabase.from("shops").select("id, section_id, name, genre_id, hours, description, sns_links, image_path").eq("map_id", id),
  ]);

  const numberBySection = new Map((sections ?? []).map((s) => [s.id, s.number]));
  const byNumber = (a: { number: string | null }, b: { number: string | null }) =>
    normalizeCode(a.number ?? "").localeCompare(normalizeCode(b.number ?? ""), "ja", { numeric: true });
  const publicUrl = (path: string) => supabase.storage.from(MAP_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;

  const rows: ShopRowData[] = (shops ?? [])
    .map((s) => ({
      id: s.id,
      sectionId: s.section_id,
      number: numberBySection.get(s.section_id) ?? null,
      name: s.name,
      genreId: s.genre_id,
      hours: s.hours,
      description: s.description,
      snsLinks: s.sns_links,
      imageUrl: s.image_path ? publicUrl(s.image_path) : null,
    }))
    .sort(byNumber);
  const withShop = new Set((shops ?? []).map((s) => s.section_id));
  const shopCountByGenre = new Map<string, number>();
  for (const s of shops ?? []) if (s.genre_id) shopCountByGenre.set(s.genre_id, (shopCountByGenre.get(s.genre_id) ?? 0) + 1);
  const freeSections = (sections ?? []).filter((s) => !withShop.has(s.id)).sort(byNumber);

  return (
    <main className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-bold">{t("title")}</h2>
          <span className="text-sm text-text-sub">{t("count", { count: rows.length })}</span>
        </div>
      </div>

      <GenreManager
        mapId={id}
        genres={(genres ?? []).map((g) => ({
          id: g.id,
          name: g.name,
          fillColor: g.fill_color,
          lineColor: g.line_color,
          textColor: g.text_color,
          shopCount: shopCountByGenre.get(g.id) ?? 0,
        }))}
      />

      <ShopImporter
        mapId={id}
        context={{
          sections: sections ?? [],
          genres: (genres ?? []).map((g) => ({ id: g.id, name: g.name })),
          sectionIdsWithShop: (shops ?? []).map((s) => s.section_id),
        }}
      />

      <ShopManager
        mapId={id}
        shops={rows}
        genres={(genres ?? []).map((g) => ({
          id: g.id,
          name: g.name,
          fillColor: g.fill_color,
          lineColor: g.line_color,
          textColor: g.text_color,
        }))}
        freeSections={freeSections}
      />
    </main>
  );
}
