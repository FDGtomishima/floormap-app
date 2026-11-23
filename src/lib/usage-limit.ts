import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UsageLimitKind } from "@/types/database";

export type UsageLimitResult = {
  allowed: boolean;
  current: number;
  /** null は上限なし */
  limit: number | null;
};

// 利用上限の確認（F-15）。マップ作成・AI実行・画像アップロードの前に呼ぶ共通処理。
// 判定は DB の check_usage_limit で行う（上限の値は plans テーブル）。
// kind が "image" のときは amount にバイト数を渡す
export async function checkUsageLimit(kind: UsageLimitKind, amount = 1): Promise<UsageLimitResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("check_usage_limit", { p_kind: kind, p_amount: amount });
  const row = data?.[0];
  if (error || !row) throw new Error(`利用上限の確認に失敗しました：${error?.message ?? "結果なし"}`);
  return { allowed: row.allowed, current: row.current_value, limit: row.limit_value };
}
