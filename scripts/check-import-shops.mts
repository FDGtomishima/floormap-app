// 工程 4-1 の確認用スクリプト：店舗の一括登録（import_shops）
//
// 実行：npm run check:import-shops
//
// 確認用の管理者2人を作り、終わったら削除する（メールは送られない）。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error(".env.local に Supabase の値が入っていません");

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

type TestUser = { id: string; client: SupabaseClient; mapId: string; sectionIds: string[]; genreId: string };

async function createTestUser(label: string): Promise<TestUser> {
  const email = `imp-check-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`ユーザー作成に失敗：${created.error?.message}`);
  const client = createClient(url!, anonKey!, authOptions);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`ログインに失敗：${signedIn.error.message}`);

  const { data: mapId, error } = await client.rpc("create_map", { p_name: "取り込み確認用" });
  if (error) throw new Error(`マップ作成に失敗：${error.message}`);
  const { data: b } = await client.from("buildings").select("id").eq("map_id", mapId).single();
  const { data: f } = await client.from("floors").insert({ building_id: (b as { id: string }).id, code: "1", name: "1階" }).select("id").single();
  const sectionIds: string[] = [];
  for (const n of ["A-101", "A-102", "A-103"]) {
    const { data: s } = await client
      .from("sections")
      .insert({ floor_id: (f as { id: string }).id, number: n, points: [[0, 0], [10, 0], [10, 10]] })
      .select("id")
      .single();
    sectionIds.push((s as { id: string }).id);
  }
  const { data: g } = await client.from("genres").select("id").eq("map_id", mapId).eq("name", "飲食").single();
  return { id: created.data.user.id, client, mapId: String(mapId), sectionIds, genreId: (g as { id: string }).id };
}

const row = (sectionId: string, name: string, extra: Record<string, unknown> = {}) => ({
  section_id: sectionId,
  name,
  genre_id: null,
  hours: null,
  description: null,
  sns_links: [],
  ...extra,
});

type Counts = { created_count: number; updated_count: number };

async function main(): Promise<void> {
  const users: TestUser[] = [];
  try {
    console.log("準備：確認用の管理者A・Bと、区画3つのマップを作成");
    const a = await createTestUser("a");
    users.push(a);
    const b = await createTestUser("b");
    users.push(b);

    console.log("\n新規登録");
    {
      const res = await a.client.rpc("import_shops", {
        p_map_id: a.mapId,
        p_rows: [
          row(a.sectionIds[0], "カフェ", { genre_id: a.genreId, hours: "10:00〜", sns_links: ["https://example.com/"] }),
          row(a.sectionIds[1], "雑貨"),
        ],
      });
      const c = ((res.data ?? []) as Counts[])[0];
      check("2件を新規で登録できる", c?.created_count === 2 && c?.updated_count === 0, res.error?.message);
      const { data } = await a.client.from("shops").select("name, genre_id, sns_links").eq("section_id", a.sectionIds[0]).single();
      const shop = data as { name: string; genre_id: string; sns_links: string[] } | null;
      check("ジャンルとリンクも保存される", shop?.genre_id === a.genreId && shop?.sns_links[0] === "https://example.com/");
    }

    console.log("\n更新（Excel を正とし、空欄は消す。画像は変えない）");
    {
      await admin.from("shops").update({ image_path: `${a.mapId}/shops/keep.png` }).eq("section_id", a.sectionIds[0]);
      const res = await a.client.rpc("import_shops", {
        p_map_id: a.mapId,
        p_rows: [row(a.sectionIds[0], "カフェ（改）"), row(a.sectionIds[2], "写真展")],
      });
      const c = ((res.data ?? []) as Counts[])[0];
      check("更新1件・新規1件と数えられる", c?.created_count === 1 && c?.updated_count === 1, res.error?.message);
      const { data } = await a.client.from("shops").select("name, genre_id, hours, sns_links, image_path").eq("section_id", a.sectionIds[0]).single();
      const shop = data as { name: string; genre_id: string | null; hours: string | null; sns_links: string[]; image_path: string | null } | null;
      check("店名が更新され、空欄の項目は消える", shop?.name === "カフェ（改）" && shop.genre_id === null && shop.hours === null && shop.sns_links.length === 0);
      check("登録済みの画像はそのまま", shop?.image_path === `${a.mapId}/shops/keep.png`);
    }

    console.log("\n他人のマップ");
    {
      const other = await b.client.rpc("import_shops", { p_map_id: a.mapId, p_rows: [row(a.sectionIds[0], "乗っ取り")] });
      check("B は A のマップに登録できない", other.error?.message === "not_found");
      const mixed = await a.client.rpc("import_shops", { p_map_id: a.mapId, p_rows: [row(a.sectionIds[1], "正しい"), row(b.sectionIds[0], "他人の区画")] });
      check("他のマップの区画が混ざっていたら全体を取り消す", mixed.error?.message === "section_not_found");
      const { data } = await a.client.from("shops").select("name").eq("section_id", a.sectionIds[1]).single();
      check("取り消された行は登録されていない（1件も変わらない）", (data as { name: string } | null)?.name === "雑貨");
      const anon = createClient(url!, anonKey!, authOptions);
      const anonRes = await anon.rpc("import_shops", { p_map_id: a.mapId, p_rows: [] });
      check("未ログインでは呼べない", anonRes.error !== null);
    }
  } finally {
    console.log("\n後片付け：確認用の管理者を削除");
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  }

  console.log(`\n結果：OK ${passed} 件 ／ NG ${failed} 件`);
  if (failed > 0) process.exitCode = 1;
}

await main();
