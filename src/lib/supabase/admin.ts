import "server-only";
import { createClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import type { Database } from "@/types/database";
import { supabaseUrl } from "./env";

// RLS を通らない運営者権限のクライアント。サーバー側の限られた処理（閲覧用データの組み立てなど）だけで使い、
// 取得した内容は必要な項目だけに絞ってから画面に渡すこと
export async function createSupabaseAdminClient() {
  await connection();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY が設定されていません");
  return createClient<Database>(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
