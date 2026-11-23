import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "管理者ログイン | フロアマップ" };

export default async function LoginPage() {
  const t = await getTranslations("login");

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <div className="space-y-1">
          <h1 className="text-xl font-bold">{t("title")}</h1>
          <p className="text-sm text-text-sub">{t("description")}</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="border-t border-line pt-4 text-center text-sm text-text-sub">
          {t("viewerNote")}{" "}
          <Link href="/" className="inline-block py-3 text-primary-text underline">
            {t("toTop")}
          </Link>
        </p>
      </div>
    </main>
  );
}
