import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CurrentAdmin = {
  id: string;
  email: string;
  emailConfirmed: boolean;
  planId: string;
  isSuspended: boolean;
};

// ログイン中の管理者を取得する（未ログインならログイン画面へ）。
// 1回のリクエスト内では結果を使い回す
export const getCurrentAdmin = cache(async (): Promise<CurrentAdmin> => {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  // トークンが残っていてもアカウントが見つからない場合は、ログイン情報を消してからログイン画面へ
  // （proxy はトークンだけで判定するため、/login へ直接戻すと /admin との間で行き来が続く）
  if (!user) redirect("/auth/signout");

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, email_confirmed, plan_id, is_suspended")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/auth/signout");

  return {
    id: user.id,
    email: profile.email,
    emailConfirmed: profile.email_confirmed,
    planId: profile.plan_id,
    isSuspended: profile.is_suspended,
  };
});
