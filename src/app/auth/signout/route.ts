import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ログイン情報を消してログイン画面へ移動する。
// トークンは有効でもアカウントが削除されている場合など、ページ側で管理者を確認できなかったときに使う
// （Server Component からは Cookie を消せないため、ここを経由する）
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });

  // サーバー側でユーザーが見つからず signOut が失敗した場合に備え、Supabase の Cookie を直接消す
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith("sb-")) cookieStore.delete(cookie.name);
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}
