// 区画番号と、その元になる建物コード・階コードの書式（docs/01_spec.md「区画番号の表記ルール」）。
// 書式のチェックはこのファイルの関数だけで行う。
//
//   区画番号 ＝ 建物（エリア）コード "-" 階コード ＋ 区画の2桁連番
//     A-101  … A棟 1階 の区画01
//     A-1001 … A棟 10階 の区画01
//     A-B101 … A棟 地下1階 の区画01
//     N-101  … 北エリア（建物なし）の区画01（階は1として扱う）

/** 建物（エリア）コード：半角英大文字1〜3文字（A、B、N など） */
const BUILDING_CODE = /^[A-Z]{1,3}$/;
/** 階コード：1〜99（先頭0なし）、または地下 B1〜B9 */
const FLOOR_CODE = /^(?:[1-9][0-9]?|B[1-9])$/;
/** 区画番号：建物コード-階コード＋2桁の連番（01〜99） */
const SECTION_NUMBER = /^([A-Z]{1,3})-((?:B[1-9])|(?:[1-9][0-9]?))((?:0[1-9])|(?:[1-9][0-9]))$/;

/** 入力のゆれをそろえる（前後の空白を除き、全角英数字・記号を半角に、英字を大文字に） */
export function normalizeCode(input: string): string {
  return input
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－ー―‐]/g, "-")
    .toUpperCase();
}

export function isValidBuildingCode(code: string): boolean {
  return BUILDING_CODE.test(code);
}

export function isValidFloorCode(code: string): boolean {
  return FLOOR_CODE.test(code);
}

/** 階コードから表示名の候補を作る（1 → 1階、B1 → 地下1階） */
export function suggestFloorName(code: string): string {
  if (!isValidFloorCode(code)) return "";
  return code.startsWith("B") ? `地下${code.slice(1)}階` : `${code}階`;
}

export type SectionNumberCheck =
  | { ok: true; buildingCode: string; floorCode: string; serial: number }
  | { ok: false };

/** 区画番号の書式チェック。書式に合わなくても保存は可（警告のみ）という扱いは呼び出し側で決める */
export function checkSectionNumber(input: string): SectionNumberCheck {
  const match = SECTION_NUMBER.exec(normalizeCode(input));
  if (!match) return { ok: false };
  return { ok: true, buildingCode: match[1], floorCode: match[2], serial: Number(match[3]) };
}
