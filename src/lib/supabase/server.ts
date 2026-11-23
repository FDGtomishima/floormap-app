import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "./env";

// サーバー側（Server Component / Server Action / Route Handler）で使う Supabase クライアント。
// ログイン中の管理者の権限で動くため、RLS がそのまま効く。
export async function createSupabaseServerClient() {
  // ログイン状態はリクエストごとに違うため、必ずリクエスト時に実行する（事前描画の対象にしない）。
  // Supabase の認証処理は内部で現在時刻を使うので、これがないと Cache Components の検証で警告が出る
  await connection();
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component からは Cookie を書けない。セッションの更新は proxy.ts が行う
        }
      },
    },
  });
}
