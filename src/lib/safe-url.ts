// 店舗の SNS リンクなど、管理者が入力した URL を安全に扱う。
// http / https 以外（javascript: など）は使わない
export function toSafeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** ボタンに表示する短い名前（例：https://www.instagram.com/abc → instagram.com） */
export function linkLabel(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}
