"use client";

// 管理画面のタブ（docs/03_ui-design.md：「マップ編集・店舗情報・公開設定」の3タブだけで行き来する）
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function MapTabs({ mapId }: { mapId: string }) {
  const t = useTranslations("mapTabs");
  const pathname = usePathname();
  const base = `/admin/maps/${mapId}`;
  const tabs = [
    { href: base, label: t("editor"), active: pathname === base },
    { href: `${base}/shops`, label: t("shops"), active: pathname.startsWith(`${base}/shops`) },
  ];

  return (
    <nav aria-label={t("label")} className="flex gap-1 border-b border-line">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={`-mb-px flex h-11 items-center border-b-2 px-4 text-sm font-bold ${
            tab.active ? "border-primary text-primary-text" : "border-transparent text-text-sub hover:text-text"
          }`}
        >
          {tab.label}
        </Link>
      ))}
      {/* 公開設定は工程 5-1 で追加する */}
      <span className="flex h-11 cursor-not-allowed items-center gap-2 px-4 text-sm font-bold text-text-sub/60">
        {t("publish")}
        <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-normal">{t("comingSoon")}</span>
      </span>
    </nav>
  );
}
