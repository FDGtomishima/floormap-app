import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MapTabs } from "./map-tabs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// マップごとの画面の共通部分：マップ名・マップコードと、マップ編集／店舗情報／公開設定のタブ
export default function MapLayout({ children, params }: LayoutProps<"/admin/maps/[id]">) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<div className="h-24" />}>
        <MapHeader params={params} />
      </Suspense>
      {children}
    </div>
  );
}

async function MapHeader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  // RLS により、本人のマップでなければ見つからない
  const [t, { data: map }] = await Promise.all([
    getTranslations("mapEditor"),
    supabase.from("maps").select("id, name, code").eq("id", id).maybeSingle(),
  ]);
  if (!map) notFound();

  return (
    <div className="space-y-3">
      <Link href="/admin" className="inline-block py-2 text-sm text-primary-text underline">
        {t("backToList")}
      </Link>
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="text-2xl font-bold">{map.name}</h1>
        <span className="font-mono tracking-widest text-text-sub">{map.code}</span>
      </div>
      <MapTabs mapId={map.id} />
    </div>
  );
}
