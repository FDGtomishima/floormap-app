import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getViewerMap } from "@/lib/public-map";
import { MapViewer } from "./map-viewer";

export const metadata: Metadata = { title: "フロアマップ" };

// マップ閲覧（F-06）。QR コードの URL は /m/[マップコード]
export default function ViewerPage({ params, searchParams }: PageProps<"/m/[code]">) {
  return (
    <Suspense fallback={<div className="flex-1 bg-bg" />}>
      <Viewer params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Viewer({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  const [t, result] = await Promise.all([getTranslations("viewer"), getViewerMap(code)]);

  if (result.status !== "ok") {
    return (
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-3 rounded-2xl border border-line bg-surface p-6 text-center">
          <h1 className="text-lg font-bold">{t("notFoundTitle")}</h1>
          <p className="text-sm text-text-sub">{t("notFoundBody")}</p>
          <Link href="/" className="inline-flex h-11 items-center text-sm text-primary-text underline">
            {t("toTop")}
          </Link>
        </div>
      </main>
    );
  }

  const map = result.data;
  const floorParam = typeof query.floor === "string" ? query.floor : null;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{map.name}</h1>
      </header>
      <MapViewer data={map} initialFloorId={floorParam} />
    </div>
  );
}
