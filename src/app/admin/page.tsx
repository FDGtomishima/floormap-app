import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getCurrentAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkUsageLimit } from "@/lib/usage-limit";
import type { PublishStatus } from "@/types/database";
import { CreateMapForm } from "./create-map-form";

export const metadata: Metadata = { title: "マップ一覧 | フロアマップ" };

// マップ一覧と新規作成（F-02）
export default async function AdminPage() {
  const t = await getTranslations("admin");

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-bold">{t("mapListTitle")}</h1>
      <Suspense fallback={<p className="text-sm text-text-sub">…</p>}>
        <MapList />
      </Suspense>
    </main>
  );
}

const statusClass: Record<PublishStatus, string> = {
  private: "border-line bg-bg text-text-sub",
  public: "border-success-line bg-success-bg text-success-text",
  limited: "border-warning-line bg-warning-bg text-warning-text",
};

async function MapList() {
  const admin = await getCurrentAdmin();
  const supabase = await createSupabaseServerClient();
  const [t, format, mapLimit, { data: maps }] = await Promise.all([
    getTranslations("admin"),
    getFormatter(),
    checkUsageLimit("map"),
    supabase
      .from("maps")
      .select("id, name, code, publish_status, updated_at")
      .order("created_at", { ascending: true }),
  ]);

  const notice = admin.isSuspended
    ? { text: t("suspended"), className: "border-error-line bg-error-bg text-error-text" }
    : !admin.emailConfirmed
      ? { text: t("emailUnconfirmed"), className: "border-warning-line bg-warning-bg-light text-warning-text" }
      : !mapLimit.allowed && mapLimit.limit !== null
        ? {
            text: `${t("limitReached", { limit: mapLimit.limit })} ${t("planGuide")}`,
            className: "border-warning-line bg-warning-bg-light text-warning-text",
          }
        : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-text-sub">
        <span>
          {mapLimit.limit === null
            ? t("mapCountUnlimited", { current: mapLimit.current })
            : t("mapCount", { current: mapLimit.current, limit: mapLimit.limit })}
        </span>
      </div>

      {notice && (
        <p role="status" className={`rounded-xl border p-3 text-sm ${notice.className}`}>
          {notice.text}
        </p>
      )}

      <CreateMapForm disabled={!admin.emailConfirmed || admin.isSuspended || !mapLimit.allowed} />

      {maps && maps.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {maps.map((map) => (
            <li key={map.id}>
              <Link
                href={`/admin/maps/${map.id}`}
                className="block space-y-3 rounded-2xl border border-line bg-surface p-5 hover:border-primary"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-bold">{map.name}</h2>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${statusClass[map.publish_status]}`}>
                    {t(`status.${map.publish_status}`)}
                  </span>
                </div>
                <dl className="flex items-center justify-between text-sm text-text-sub">
                  <div className="flex gap-2">
                    <dt>{t("mapCode")}</dt>
                    <dd className="font-mono tracking-widest text-text">{map.code}</dd>
                  </div>
                  <dd>{t("updatedAt", { date: format.dateTime(new Date(map.updated_at), { dateStyle: "medium" }) })}</dd>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-text-sub">
          {t("noMaps")}
        </div>
      )}
    </div>
  );
}
