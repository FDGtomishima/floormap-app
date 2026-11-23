"use server";

import type { AuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getSiteOrigin } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthErrorKey =
  | "required"
  | "invalidCredentials"
  | "weakPassword"
  | "invalidEmail"
  | "rateLimited"
  | "emailNotAllowed"
  | "unknown";

export type AuthFormState =
  | { status: "idle" }
  | { status: "error"; error: AuthErrorKey; email: string }
  | { status: "confirmationSent"; email: string }
  | { status: "unconfirmed"; email: string; resent: boolean };

function readCredentials(formData: FormData): { email: string; password: string } {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  return { email, password };
}

function toErrorKey(error: AuthError): AuthErrorKey {
  switch (error.code) {
    case "invalid_credentials":
      return "invalidCredentials";
    case "weak_password":
      return "weakPassword";
    case "email_address_invalid":
    case "validation_failed":
      return "invalidEmail";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "rateLimited";
    case "email_address_not_authorized":
      return "emailNotAllowed";
    default:
      return "unknown";
  }
}

async function emailRedirectTo(): Promise<string> {
  return `${await getSiteOrigin()}/auth/confirm`;
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) return { status: "error", error: "required", email };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") return { status: "unconfirmed", email, resent: false };
    return { status: "error", error: toErrorKey(error), email };
  }
  redirect("/admin");
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) return { status: "error", error: "required", email };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: await emailRedirectTo() },
  });
  if (error) return { status: "error", error: toErrorKey(error), email };

  // 登録済みのメールアドレスでも同じ表示にする（登録の有無を外から分からないようにするため）
  return { status: "confirmationSent", email };
}

export async function resendConfirmation(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { status: "error", error: "required", email };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: await emailRedirectTo() },
  });
  if (error) return { status: "error", error: toErrorKey(error), email };
  return { status: "unconfirmed", email, resent: true };
}
