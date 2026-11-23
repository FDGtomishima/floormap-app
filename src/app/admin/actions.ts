"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type CreateMapErrorKey =
  | "email_not_confirmed"
  | "account_suspended"
  | "limit_exceeded"
  | "invalid_name"
  | "unknown";

export type CreateMapState = { error: CreateMapErrorKey | null; name: string };

const KNOWN_ERRORS: readonly CreateMapErrorKey[] = [
  "email_not_confirmed",
  "account_suspended",
  "limit_exceeded",
  "invalid_name",
];

// マップ作成（F-02）。上限チェック・マップコード生成・初期データ登録は DB の create_map が行う
export async function createMap(_prev: CreateMapState, formData: FormData): Promise<CreateMapState> {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 100) return { error: "invalid_name", name };

  const supabase = await createSupabaseServerClient();
  const { data: mapId, error } = await supabase.rpc("create_map", { p_name: name });
  if (error || !mapId) {
    const key = KNOWN_ERRORS.find((k) => k === error?.message) ?? "unknown";
    if (key === "unknown") console.error("create_map failed", error);
    return { error: key, name };
  }
  redirect(`/admin/maps/${mapId}`);
}
