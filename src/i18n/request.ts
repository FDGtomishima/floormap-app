import { getRequestConfig } from "next-intl/server";

// 画面の文言は messages/{言語}.json で管理する。
// 言語の切り替えは工程 6-1 / 6-4 で追加する。それまでは日本語に固定
export const defaultLocale = "ja";

export default getRequestConfig(async () => {
  const locale = defaultLocale;
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages, timeZone: "Asia/Tokyo" };
});
