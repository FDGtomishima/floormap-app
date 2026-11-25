"use client";

// 店舗詳細パネル（F-08）。スマホは画面の下から出るパネル（背景を薄く暗くし、タップで閉じる）、PC は右側のパネル
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import type { PublicBuilding, PublicFloor, PublicGenre, PublicSection } from "@/lib/public-map";
import { linkLabel, toSafeHttpUrl } from "@/lib/safe-url";

export function ShopPanel({
  section,
  building,
  floor,
  genres,
  onClose,
}: {
  section: PublicSection;
  building: PublicBuilding;
  floor: PublicFloor;
  genres: PublicGenre[];
  onClose: () => void;
}) {
  const t = useTranslations("viewer.panel");
  const closeRef = useRef<HTMLButtonElement>(null);
  const shop = section.shop;
  const genre = shop?.genreId ? genres.find((g) => g.id === shop.genreId) : undefined;
  const links = (shop?.snsLinks ?? []).map(toSafeHttpUrl).filter((u): u is URL => u !== null);

  // 開いたら閉じるボタンに移り、Esc で閉じる
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [section.id, onClose]);

  const title = shop?.name ?? (section.number ? t("sectionNumber", { number: section.number }) : "");

  return (
    <>
      {/* スマホ：背景を薄く暗くし、タップで閉じる */}
      <div className="fixed inset-0 z-20 bg-text/30 md:hidden" onClick={onClose} aria-hidden />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-x-0 bottom-0 z-30 max-h-[75dvh] overflow-y-auto rounded-t-2xl bg-surface shadow-2xl md:absolute md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-96 md:rounded-none md:border-l md:border-line md:shadow-lg"
      >
        <div className="sticky top-0 z-10 flex justify-center bg-surface pt-2 md:hidden" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-line" />
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="absolute top-2 right-2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-surface/90 text-xl text-text-sub hover:bg-bg"
        >
          ×
        </button>

        {shop?.imageUrl && (
          // 店舗画像は管理者がアップロードしたもの（Storage の公開URL）
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shop.imageUrl}
            alt={t("imageAlt", { name: shop.name })}
            loading="lazy"
            className="aspect-[16/9] w-full object-cover md:mt-0"
          />
        )}

        <div className="space-y-3 p-5 pr-14">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {shop &&
              (genre ? (
                <span
                  className="rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-bold"
                  style={{ backgroundColor: genre.fillColor, borderColor: genre.lineColor, color: genre.textColor }}
                >
                  {genre.name}
                </span>
              ) : (
                <span className="rounded-full border border-line bg-bg px-2.5 py-0.5 text-xs text-text-sub">{t("noGenre")}</span>
              ))}
            <span className="text-text-sub">
              {t("location", { building: building.name, floor: floor.name })}
              {/* 店舗がない区画は、見出しに区画番号を出すのでここでは省く */}
              {shop && section.number && ` ・ ${section.number}`}
            </span>
          </div>

          <h2 className="text-xl font-bold">{title}</h2>

          {!shop ? (
            <p className="text-sm text-text-sub">{t("noShop")}</p>
          ) : (
            <>
              {shop.hours && (
                <div className="space-y-0.5">
                  <h3 className="text-xs font-medium text-text-sub">{t("hours")}</h3>
                  <p className="whitespace-pre-line">{shop.hours}</p>
                </div>
              )}
              {shop.description && <p className="whitespace-pre-line leading-relaxed">{shop.description}</p>}
              {links.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-xs font-medium text-text-sub">{t("links")}</h3>
                  <ul className="flex flex-wrap gap-2">
                    {links.map((url) => (
                      <li key={url.href}>
                        <a
                          href={url.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-11 items-center rounded-xl border border-line px-4 text-sm font-medium text-primary-text hover:bg-selected-bg"
                        >
                          {linkLabel(url)} ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
