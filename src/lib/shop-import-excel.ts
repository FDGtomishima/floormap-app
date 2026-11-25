// ブラウザで Excel を読む（SheetJS）。SheetJS は大きいので、使うときにだけ読み込む
import { IMPORT_COLUMNS, IMPORT_LIMITS, REQUIRED_COLUMNS, type ImportInputRow } from "./shop-import";

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const IMPORT_ACCEPT = ".xlsx,.xls,.csv";

export type SheetReadResult =
  | { ok: true; rows: ImportInputRow[] }
  | { ok: false; error: "missingColumns"; missing: string[] }
  | { ok: false; error: "noRows" }
  | { ok: false; error: "tooManyRows"; max: number };

export type WorkbookReader = { sheetNames: string[]; readSheet: (name: string) => SheetReadResult };

type Column = (typeof IMPORT_COLUMNS)[number];
const normalizeHeader = (value: string) => value.replace(/\s+/g, "").trim();

export async function openWorkbook(file: File): Promise<WorkbookReader> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });

  function readSheet(name: string): SheetReadResult {
    const sheet = workbook.Sheets[name];
    if (!sheet) return { ok: false, error: "noRows" };
    // 表示どおりの文字列で読む（「10:00」が時刻の数値にならないように）
    const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", blankrows: false });
    const cells = table.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));

    // 見出しの行：「区画番号」と「店名」がある最初の行（上に説明の行があってもよい）
    const headerIndex = cells.findIndex((row) => {
      const headers = row.map(normalizeHeader);
      return REQUIRED_COLUMNS.every((c) => headers.includes(c));
    });
    if (headerIndex < 0) {
      const first = (cells[0] ?? []).map(normalizeHeader);
      return { ok: false, error: "missingColumns", missing: REQUIRED_COLUMNS.filter((c) => !first.includes(c)) };
    }

    const headers = cells[headerIndex].map(normalizeHeader);
    const indexOf = (column: Column) => headers.indexOf(column);
    const get = (row: string[], column: Column) => {
      const i = indexOf(column);
      return i >= 0 ? (row[i] ?? "") : "";
    };

    const rows: ImportInputRow[] = [];
    for (let i = headerIndex + 1; i < cells.length; i++) {
      const row = cells[i];
      if (row.every((cell) => cell.trim() === "")) continue; // 空の行は飛ばす
      rows.push({
        rowNumber: i + 1, // Excel の行番号
        sectionNumber: get(row, "区画番号"),
        name: get(row, "店名"),
        genre: get(row, "ジャンル"),
        hours: get(row, "営業時間"),
        description: get(row, "紹介文"),
        image: get(row, "画像"),
        snsLinks: get(row, "SNSリンク"),
      });
    }
    if (rows.length === 0) return { ok: false, error: "noRows" };
    if (rows.length > IMPORT_LIMITS.maxRows) return { ok: false, error: "tooManyRows", max: IMPORT_LIMITS.maxRows };
    return { ok: true, rows };
  }

  return { sheetNames: workbook.SheetNames, readSheet };
}

/** 取り込み用 Excel のひな形をダウンロードする */
export async function downloadImportTemplate(fileName: string): Promise<void> {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([
    [...IMPORT_COLUMNS],
    ["A-101", "（例）カフェ〇〇", "飲食", "10:00〜18:00", "自家焙煎のコーヒー店です。", "cafe.jpg", "https://instagram.com/example"],
  ]);
  sheet["!cols"] = [{ wch: 10 }, { wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 40 }, { wch: 14 }, { wch: 40 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "店舗情報");
  XLSX.writeFile(book, fileName);
}
