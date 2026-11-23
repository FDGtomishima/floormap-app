import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MAP_IMAGES_BUCKET } from "@/lib/floor-image-config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FloorImageUploader } from "./floor-image-uploader";
import { StructurePanel, type BuildingItem } from "./structure-panel";

export const metadata: Metadata = { title: "マップ編集 | フロアマップ" };

// マップ編集。左に建物・フロアの一覧（F-03）、中央に選択中のフロア。
// 図面と区画の編集は工程 2-2 以降で追加する
export default function MapEditorPage({ params, searchParams }: PageProps<"/admin/maps/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-text-sub">…</p>}>
      <MapEditor params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function MapEditor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID_PATTERN.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  // RLS により、本人のマップでなければ見つからない
  const [t, { data: map }, { data: buildings }, { data: floors }, { data: sections }] = await Promise.all([
    getTranslations("mapEditor"),
    supabase.from("maps").select("id, name, code").eq("id", id).maybeSingle(),
    supabase.from("buildings").select("id, code, name").eq("map_id", id).order("sort_order").order("created_at"),
    supabase
      .from("floors")
      .select("id, building_id, code, name, edit_image_path, image_width, image_height")
      .eq("map_id", id)
      .order("sort_order")
      .order("created_at"),
    supabase.from("sections").select("floor_id").eq("map_id", id),
  ]);
  if (!map) notFound();

  const sectionCounts = new Map<string, number>();
  for (const s of sections ?? []) sectionCounts.set(s.floor_id, (sectionCounts.get(s.floor_id) ?? 0) + 1);

  const tree: BuildingItem[] = (buildings ?? []).map((b) => ({
    ...b,
    floors: (floors ?? [])
      .filter((f) => f.building_id === b.id)
      .map((f) => ({ id: f.id, code: f.code, name: f.name, sectionCount: sectionCounts.get(f.id) ?? 0 })),
  }));
  const floorById = new Map((floors ?? []).map((f) => [f.id, f]));
  const orderedFloors = tree.flatMap((b) => b.floors.map((f) => ({ ...f, building: b })));

  // 選択中のフロア：URL の ?floor= が正しければそれ、なければ最初のフロア
  const requested = typeof query.floor === "string" ? query.floor : null;
  const selected = orderedFloors.find((f) => f.id === requested) ?? orderedFloors[0] ?? null;
  const selectedRow = selected ? floorById.get(selected.id) : undefined;
  const image =
    selectedRow?.edit_image_path && selectedRow.image_width && selectedRow.image_height
      ? {
          url: supabase.storage.from(MAP_IMAGES_BUCKET).getPublicUrl(selectedRow.edit_image_path).data.publicUrl,
          width: selectedRow.image_width,
          height: selectedRow.image_height,
        }
      : null;

  return (
    <main className="space-y-6">
      <div className="space-y-1">
        <Link href="/admin" className="inline-block py-2 text-sm text-primary-text underline">
          {t("backToList")}
        </Link>
        <div className="flex flex-wrap items-baseline gap-4">
          <h1 className="text-2xl font-bold">{map.name}</h1>
          <span className="font-mono tracking-widest text-text-sub">{map.code}</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-2xl border border-line bg-surface p-4">
          <StructurePanel mapId={map.id} buildings={tree} selectedFloorId={selected?.id ?? null} />
        </aside>

        <section className="min-h-[480px] rounded-2xl border border-line bg-surface p-6">
          {selected ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold">
                  {selected.building.name} ／ {selected.name}
                </h2>
                {image && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-text-sub">{t("imageSize", { width: image.width, height: image.height })}</span>
                    <FloorImageUploader key={selected.id} floorId={selected.id} hasImage sectionCount={selected.sectionCount} />
                  </div>
                )}
              </div>
              {image ? (
                <div className="overflow-auto rounded-xl border border-line bg-bg">
                  {/* 図面の表示は工程 2-3 で SVG の区画エディタに置き換える */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt={t("imageAlt", { name: selected.name })}
                    width={image.width}
                    height={image.height}
                    className="h-auto max-h-[70vh] w-full object-contain"
                  />
                </div>
              ) : (
                <FloorImageUploader key={selected.id} floorId={selected.id} hasImage={false} sectionCount={selected.sectionCount} />
              )}
            </div>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center text-sm text-text-sub">
              {t("noFloorSelected")}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
