// 店舗情報の取り込み（F-09）の照合とチェック。
// 画面（プレビュー）とサーバー（確定登録）の両方で同じ関数を使い、サーバーでは画面から来た結果を信用せず必ずやり直す。
// Excel の読み込みそのもの（SheetJS）は src/lib/shop-import-excel.ts（ブラウザ側）
import { checkSectionNumber, normalizeCode } from "./section-number";
import { toSafeHttpUrl } from "./safe-url";

/** 取り込み用 Excel の列（docs/01_spec.md「Excel取り込みの書式」） */
export const IMPORT_COLUMNS = ["区画番号", "店名", "ジャンル", "営業時間", "紹介文", "画像", "SNSリンク"] as const;
export const REQUIRED_COLUMNS = ["区画番号", "店名"] as const;

export const IMPORT_LIMITS = {
  maxRows: 2000,
  name: 100,
  hours: 200,
  description: 2000,
  links: 10,
} as const;

/** Excel の1行（文字列のまま） */
export type ImportInputRow = {
  rowNumber: number;
  sectionNumber: string;
  name: string;
  genre: string;
  hours: string;
  description: string;
  image: string;
  snsLinks: string;
};

export type ImportIssue =
  | { code: "sectionNumberMissing" }
  | { code: "sectionNumberFormat"; value: string }
  | { code: "sectionNotFound"; value: string }
  | { code: "duplicateInFile"; value: string; firstRow: number }
  | { code: "nameMissing" }
  | { code: "tooLong"; field: "name" | "hours" | "description"; max: number }
  | { code: "invalidLink"; value: string }
  | { code: "tooManyLinks"; max: number }
  // ここから下は警告（登録はする）
  | { code: "genreNotFound"; value: string };

export type ImportPlanRow = {
  rowNumber: number;
  sectionNumber: string;
  name: string;
  genreName: string;
  status: "new" | "update" | "error";
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** 登録する内容（エラーの行は null） */
  values: {
    sectionId: string;
    name: string;
    genreId: string | null;
    hours: string | null;
    description: string | null;
    snsLinks: string[];
    imageFileName: string | null;
  } | null;
};

export type ImportContext = {
  sections: { id: string; number: string | null }[];
  genres: { id: string; name: string }[];
  /** すでに店舗がある区画の id（更新になる） */
  sectionIdsWithShop: string[];
};

export type ImportSummary = { newCount: number; updateCount: number; errorCount: number; warningCount: number };

const emptyToNull = (value: string) => (value.trim() === "" ? null : value.trim());

/** セル内の改行で区切られた SNS リンクを分ける */
export function splitLinks(value: string): string[] {
  return value
    .split(/\r\n|\r|\n/)
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

export type ShopFieldIssue = Extract<ImportIssue, { code: "nameMissing" | "tooLong" | "invalidLink" | "tooManyLinks" }>;

export type ShopFieldValues = { name: string; hours: string | null; description: string | null; snsLinks: string[] };

/**
 * 店舗の項目のチェック（Excel 取り込みと個別編集で共通）。
 * 店名は必須、長さの上限、SNS リンクは http / https だけ（改行区切り）
 */
export function checkShopFields(input: { name: string; hours: string; description: string; snsLinks: string }): {
  issues: ShopFieldIssue[];
  values: ShopFieldValues;
} {
  const issues: ShopFieldIssue[] = [];
  const name = input.name.trim();
  if (name === "") issues.push({ code: "nameMissing" });
  else if (name.length > IMPORT_LIMITS.name) issues.push({ code: "tooLong", field: "name", max: IMPORT_LIMITS.name });

  const hours = emptyToNull(input.hours);
  if (hours && hours.length > IMPORT_LIMITS.hours) issues.push({ code: "tooLong", field: "hours", max: IMPORT_LIMITS.hours });
  const description = emptyToNull(input.description);
  if (description && description.length > IMPORT_LIMITS.description) {
    issues.push({ code: "tooLong", field: "description", max: IMPORT_LIMITS.description });
  }

  const links = splitLinks(input.snsLinks);
  const snsLinks: string[] = [];
  for (const link of links) {
    const url = toSafeHttpUrl(link);
    if (url) snsLinks.push(url.href);
    else issues.push({ code: "invalidLink", value: link });
  }
  if (links.length > IMPORT_LIMITS.links) issues.push({ code: "tooManyLinks", max: IMPORT_LIMITS.links });

  return { issues, values: { name, hours, description, snsLinks } };
}

export function planImport(rows: ImportInputRow[], context: ImportContext): ImportPlanRow[] {
  const sectionByNumber = new Map<string, string>();
  for (const s of context.sections) if (s.number) sectionByNumber.set(normalizeCode(s.number), s.id);
  const genreByName = new Map(context.genres.map((g) => [g.name.trim(), g.id]));
  const withShop = new Set(context.sectionIdsWithShop);
  const firstRowOfNumber = new Map<string, number>();

  return rows.map((row) => {
    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];

    // 区画番号：空欄・書式・マップにあるか・ファイル内の重複
    const number = normalizeCode(row.sectionNumber);
    let sectionId: string | undefined;
    if (number === "") {
      errors.push({ code: "sectionNumberMissing" });
    } else if (!checkSectionNumber(number).ok) {
      errors.push({ code: "sectionNumberFormat", value: row.sectionNumber.trim() });
    } else {
      const first = firstRowOfNumber.get(number);
      if (first !== undefined) {
        errors.push({ code: "duplicateInFile", value: number, firstRow: first });
      } else {
        firstRowOfNumber.set(number, row.rowNumber);
        sectionId = sectionByNumber.get(number);
        if (!sectionId) errors.push({ code: "sectionNotFound", value: number });
      }
    }

    // 店名・営業時間・紹介文・SNS リンク（個別編集と共通のチェック）
    const fields = checkShopFields({ name: row.name, hours: row.hours, description: row.description, snsLinks: row.snsLinks });
    errors.push(...fields.issues);

    // ジャンル：一覧にない名前は「未分類」で登録し、警告する
    const genreName = row.genre.trim();
    let genreId: string | null = null;
    if (genreName !== "") {
      genreId = genreByName.get(genreName) ?? null;
      if (!genreId) warnings.push({ code: "genreNotFound", value: genreName });
    }

    const hasError = errors.length > 0 || !sectionId;
    return {
      rowNumber: row.rowNumber,
      sectionNumber: number || row.sectionNumber.trim(),
      name: fields.values.name,
      genreName,
      status: hasError ? "error" : withShop.has(sectionId!) ? "update" : "new",
      errors,
      warnings,
      values: hasError
        ? null
        : {
            sectionId: sectionId!,
            genreId,
            ...fields.values,
            imageFileName: emptyToNull(row.image),
          },
    };
  });
}

export function summarize(plan: ImportPlanRow[]): ImportSummary {
  return {
    newCount: plan.filter((r) => r.status === "new").length,
    updateCount: plan.filter((r) => r.status === "update").length,
    errorCount: plan.filter((r) => r.status === "error").length,
    warningCount: plan.filter((r) => r.warnings.length > 0).length,
  };
}
