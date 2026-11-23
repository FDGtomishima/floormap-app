import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { Noto_Sans_JP } from "next/font/google";
import { defaultLocale } from "@/i18n/request";
import "./globals.css";

const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "フロアマップ",
  description: "区画をタップして店舗の詳細が見られるフロアマップ",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={defaultLocale} className={`${notoSansJp.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
