import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getCurrentAdmin } from "@/lib/auth";
import { signOut } from "./actions";

// 管理画面の共通ヘッダー
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const t = await getTranslations("common");

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-6">
          <Link href="/admin" className="text-lg font-bold">
            {t("appName")}
          </Link>
          <Suspense>
            <AccountMenu />
          </Suspense>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-8">{children}</div>
    </div>
  );
}

async function AccountMenu() {
  const [admin, t] = await Promise.all([getCurrentAdmin(), getTranslations("admin")]);
  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-text-sub sm:inline">{admin.email}</span>
      <form action={signOut}>
        <button type="submit" className="h-11 rounded-xl border border-line px-4 text-sm font-medium hover:bg-bg">
          {t("logout")}
        </button>
      </form>
    </div>
  );
}
