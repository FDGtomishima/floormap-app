// 工程 1-4 / 1-5 の確認用スクリプト：マップ作成（create_map）と利用上限チェック（check_usage_limit）
//
// 実行：npm run check:create-map
//
// 確認用の管理者を作り、終わったら削除する（メールは送られない）。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  throw new Error(".env.local に Supabase の値が入っていません");
}

const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, authOptions);

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  OK  ${label}`);
  } else {
    failed += 1;
    console.log(`  NG  ${label}${detail ? `（${detail}）` : ""}`);
  }
}

type TestUser = { id: string; client: SupabaseClient };

async function createTestUser(label: string, confirmed: boolean): Promise<TestUser> {
  const email = `map-check-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`ユーザー作成に失敗：${created.error?.message}`);
  const id = created.data.user.id;

  const client = createClient(url!, anonKey!, authOptions);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`ログインに失敗：${signedIn.error.message}`);

  // 未確認の状態はログインできないため、ログイン後に profiles 側を未確認にして再現する
  if (!confirmed) await admin.from("profiles").update({ email_confirmed: false }).eq("id", id);
  return { id, client };
}

type LimitRow = { allowed: boolean; current_value: number; limit_value: number | null };

async function limit(user: TestUser, kind: string, amount = 1): Promise<LimitRow | null> {
  const { data } = await user.client.rpc("check_usage_limit", { p_kind: kind, p_amount: amount });
  return ((data ?? []) as LimitRow[])[0] ?? null;
}

async function main(): Promise<void> {
  const users: TestUser[] = [];
  try {
    console.log("準備：確認用の管理者を作成");
    const a = await createTestUser("a", true);
    users.push(a);
    const unconfirmed = await createTestUser("u", false);
    users.push(unconfirmed);

    console.log("\n利用上限チェック（作成前）");
    {
      const map = await limit(a, "map");
      check("マップ：0 / 1 で作成できる", map?.allowed === true && map.current_value === 0 && map.limit_value === 1);
      const ai = await limit(a, "ai");
      check("AI：0 / 1 で実行できる", ai?.allowed === true && ai.current_value === 0 && ai.limit_value === 1);
      const image = await limit(a, "image", 50_000_000);
      check("画像容量：上限なし（NULL）なら大きな量でも可", image?.allowed === true && image.limit_value === null);
      const bad = await a.client.rpc("check_usage_limit", { p_kind: "unknown", p_amount: 1 });
      check("不明な種類はエラー", bad.error?.message === "invalid_kind");
    }

    console.log("\nマップ作成");
    let mapId = "";
    {
      const empty = await a.client.rpc("create_map", { p_name: "   " });
      check("空のマップ名は作成できない", empty.error?.message === "invalid_name");

      const created = await a.client.rpc("create_map", { p_name: "  確認用マップ  " });
      check("マップを作成できる", !created.error && typeof created.data === "string", created.error?.message);
      mapId = String(created.data ?? "");

      const { data: map } = await a.client.from("maps").select("name, code, owner_id, publish_status").eq("id", mapId).single();
      const row = map as { name: string; code: string; owner_id: string; publish_status: string } | null;
      check("マップ名は前後の空白を除いて保存される", row?.name === "確認用マップ");
      check("持ち主は本人", row?.owner_id === a.id);
      check("初期状態は非公開", row?.publish_status === "private");
      check("マップコードは紛らわしい文字を含まない6文字", /^[A-HJKMNP-Z2-9]{6}$/.test(row?.code ?? ""), row?.code);

      const { data: genres } = await a.client.from("genres").select("name").eq("map_id", mapId).order("sort_order");
      const names = ((genres ?? []) as { name: string }[]).map((g) => g.name).join(",");
      check("初期ジャンル6件が登録される", names === "飲食,物販,展示,体験・ワークショップ,サービス,施設", names);

      const { data: buildings } = await a.client.from("buildings").select("code, name").eq("map_id", mapId);
      const b = (buildings ?? []) as { code: string; name: string }[];
      check("建物1件（A／A棟）が登録される", b.length === 1 && b[0].code === "A" && b[0].name === "A棟");
    }

    console.log("\n上限に達したあと");
    {
      const map = await limit(a, "map");
      check("マップ：1 / 1 で作成できない", map?.allowed === false && map.current_value === 1);
      const second = await a.client.rpc("create_map", { p_name: "2つ目" });
      check("2つ目のマップは作成できない", second.error?.message === "limit_exceeded");

      await a.client.from("maps").delete().eq("id", mapId);
      const after = await limit(a, "map");
      check("マップを削除すると、また作成できる", after?.allowed === true && after.current_value === 0);
    }

    console.log("\n作成できない管理者");
    {
      const res = await unconfirmed.client.rpc("create_map", { p_name: "未確認" });
      check("メール未確認では作成できない", res.error?.message === "email_not_confirmed");

      await admin.from("profiles").update({ is_suspended: true }).eq("id", a.id);
      const suspended = await a.client.rpc("create_map", { p_name: "停止中" });
      check("停止中は作成できない", suspended.error?.message === "account_suspended");
      const lim = await limit(a, "map");
      check("停止中は上限チェックも不可になる", lim?.allowed === false);
      await admin.from("profiles").update({ is_suspended: false }).eq("id", a.id);

      const anon = createClient(url!, anonKey!, authOptions);
      const anonRes = await anon.rpc("create_map", { p_name: "未ログイン" });
      check("未ログインでは作成できない", anonRes.error !== null);
      const gen = await a.client.rpc("generate_map_code");
      check("マップコード生成関数は画面から直接呼べない", gen.error !== null);
    }
  } finally {
    console.log("\n後片付け：確認用の管理者を削除");
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  }

  console.log(`\n結果：OK ${passed} 件 ／ NG ${failed} 件`);
  if (failed > 0) process.exitCode = 1;
}

await main();
