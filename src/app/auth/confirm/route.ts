import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (OTP_TYPES as readonly string[]).includes(value);
}

// 確認メールのリンクの戻り先。確認が済んだらログイン状態にしてマップ一覧へ移動する。
//   ・token_hash＋type：メールのテンプレートを {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email にした場合
//   ・code：既定のテンプレート（{{ .ConfirmationURL }}）の場合。登録したのと同じブラウザで開いたときだけ使える
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  const supabase = await createSupabaseServerClient();
  let ok = false;
  if (tokenHash && isOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const url = request.nextUrl.clone();
  url.search = "";
  if (ok) {
    url.pathname = "/admin";
  } else {
    url.pathname = "/login";
    url.searchParams.set("confirm", "failed");
  }
  return NextResponse.redirect(url);
}
