// 工程 1-2 の確認用スクリプト：行単位の権限（RLS）が仕様どおりに効いているかを確かめる。
//
// 実行：npm run check:rls
//
// 確認用の管理者を2人（A・B）作り、終わったら削除する（メールは送られない）。
// .env.local の Supabase の値を使う。service role キーはこのスクリプト内だけで使い、画面には出さない。

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

async function createTestUser(label: string): Promise<TestUser> {
  const email = `rls-check-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`ユーザー作成に失敗：${created.error?.message}`);

  const client = createClient(url!, anonKey!, authOptions);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`ログインに失敗：${signedIn.error.message}`);
  return { id: created.data.user.id, client };
}

function mapCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

async function createMapAsAdmin(ownerId: string, name: string): Promise<string> {
  const { data, error } = await admin
    .from("maps")
    .insert({ owner_id: ownerId, name, code: mapCode() })
    .select("id")
    .single();
  if (error || !data) throw new Error(`マップ作成に失敗：${error?.message}`);
  return (data as { id: string }).id;
}

async function main(): Promise<void> {
  const users: TestUser[] = [];
  try {
    console.log("準備：確認用の管理者A・Bとマップを作成");
    const a = await createTestUser("a");
    users.push(a);
    const b = await createTestUser("b");
    users.push(b);
    const mapA = await createMapAsAdmin(a.id, "Aのマップ");
    const mapB = await createMapAsAdmin(b.id, "Bのマップ");

    console.log("\n登録時の自動作成");
    {
      const { data } = await a.client.from("profiles").select("id, plan_id, email_confirmed");
      const rows = (data ?? []) as { id: string; plan_id: string; email_confirmed: boolean }[];
      check("profiles が自動作成され、本人の1行だけ見える", rows.length === 1 && rows[0].id === a.id);
      check("初期プランは無料プラン", rows[0]?.plan_id === "free");
      check("メール確認済みが同期される", rows[0]?.email_confirmed === true);
      const usage = await a.client.from("usage").select("profile_id");
      check("usage が自動作成され、本人の1行だけ見える", (usage.data ?? []).length === 1);
    }

    console.log("\n本人以外のデータは見えない・変えられない");
    {
      const { data } = await a.client.from("maps").select("id");
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      check("A には自分のマップだけ見える", ids.length === 1 && ids[0] === mapA);

      const upd = await a.client.from("maps").update({ name: "書き換え" }).eq("id", mapB).select("id");
      check("A は B のマップ名を変更できない", (upd.data ?? []).length === 0);
      const del = await a.client.from("maps").delete().eq("id", mapB).select("id");
      check("A は B のマップを削除できない", (del.data ?? []).length === 0);

      const bld = await a.client.from("buildings").insert({ map_id: mapB, code: "A", name: "A棟" });
      check("A は B のマップに建物を追加できない", bld.error !== null);
    }

    console.log("\n画面から変えてはいけない項目");
    {
      const ins = await a.client.from("maps").insert({ owner_id: a.id, name: "直接作成", code: mapCode() });
      check("マップを画面から直接作成できない（サーバー側の処理で作る）", ins.error !== null);
      const own = await a.client.from("maps").update({ owner_id: b.id }).eq("id", mapA);
      check("マップの持ち主を変更できない", own.error !== null);
      const code = await a.client.from("maps").update({ code: "ZZZZZZ" }).eq("id", mapA);
      check("マップコードを変更できない", code.error !== null);
      const plan = await a.client.from("profiles").update({ plan_id: "free" }).eq("id", a.id);
      check("自分のプランを変更できない", plan.error !== null);
      const usage = await a.client.from("usage").update({ ai_runs: 0 }).eq("profile_id", a.id);
      check("利用状況を変更できない", usage.error !== null);
      const pub = await a.client.from("map_publications").insert({ map_id: mapA, data: {} });
      check("公開版を画面から直接作成できない", pub.error !== null);
    }

    console.log("\n本人のマップは編集できる");
    let sectionId = "";
    {
      const upd = await a.client.from("maps").update({ name: "Aのマップ（変更）" }).eq("id", mapA).select("id");
      check("自分のマップ名を変更できる", (upd.data ?? []).length === 1, upd.error?.message);

      const genre = await a.client
        .from("genres")
        .insert({ map_id: mapA, name: "飲食", fill_color: "#FFE8D6", line_color: "#E8833A", text_color: "#8A4210" })
        .select("id")
        .single();
      check("ジャンルを追加できる", genre.error === null, genre.error?.message);

      const bld = await a.client
        .from("buildings")
        .insert({ map_id: mapA, code: "A", name: "A棟" })
        .select("id")
        .single();
      check("建物を追加できる", bld.error === null, bld.error?.message);
      const buildingId = (bld.data as { id: string } | null)?.id ?? "";

      // map_id に別のマップを送っても、親の建物から正しく設定される
      const flr = await a.client
        .from("floors")
        .insert({ building_id: buildingId, map_id: mapB, code: "1", name: "1階" })
        .select("id, map_id")
        .single();
      const floor = flr.data as { id: string; map_id: string } | null;
      check("フロアを追加でき、map_id は親から設定される", floor?.map_id === mapA, flr.error?.message);

      const points = [[120, 80], [260, 80], [260, 190], [120, 190]];
      const sec = await a.client
        .from("sections")
        .insert({ floor_id: floor?.id, number: "A-101", points })
        .select("id")
        .single();
      check("区画を追加できる", sec.error === null, sec.error?.message);
      sectionId = (sec.data as { id: string } | null)?.id ?? "";

      const dup = await a.client.from("sections").insert({ floor_id: floor?.id, number: "A-101", points });
      check("同じマップ内で区画番号が重複すると保存できない", dup.error !== null);

      const noNum = await a.client.from("sections").insert({ floor_id: floor?.id, number: null, points });
      const noNum2 = await a.client.from("sections").insert({ floor_id: floor?.id, number: null, points });
      check("番号未設定の区画は複数保存できる", noNum.error === null && noNum2.error === null);

      const shop = await a.client
        .from("shops")
        .insert({ section_id: sectionId, name: "カフェ", genre_id: (genre.data as { id: string } | null)?.id })
        .select("id")
        .single();
      check("店舗を追加できる", shop.error === null, shop.error?.message);
      const shopId = (shop.data as { id: string } | null)?.id ?? "";

      const shop2 = await a.client.from("shops").insert({ section_id: sectionId, name: "2店舗目" });
      check("1区画に2店舗は登録できない", shop2.error !== null);

      const tr = await a.client.from("shop_translations").insert({ shop_id: shopId, lang: "en", name: "Cafe" });
      check("翻訳を追加できる", tr.error === null, tr.error?.message);

      const bSees = await b.client.from("shops").select("id");
      check("B には A の店舗が見えない", (bSees.data ?? []).length === 0);
    }

    console.log("\n閲覧者（未ログイン）");
    {
      const anon = createClient(url!, anonKey!, authOptions);
      for (const table of ["maps", "buildings", "floors", "sections", "shops", "genres", "map_publications"]) {
        const { data } = await anon.from(table).select("*").limit(1);
        check(`${table} の下書きは見えない`, (data ?? []).length === 0);
      }
    }

    console.log("\n停止中のアカウント");
    {
      await admin.from("profiles").update({ is_suspended: true }).eq("id", a.id);
      const upd = await a.client.from("maps").update({ name: "停止中の変更" }).eq("id", mapA).select("id");
      check("停止中は自分のマップも変更できない", (upd.data ?? []).length === 0);
    }

    console.log("\n画像（Storage）");
    {
      await admin.from("profiles").update({ is_suspended: false }).eq("id", a.id);
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const own = await a.client.storage.from("map-images").upload(`${mapA}/check.png`, png, { contentType: "image/png" });
      check("自分のマップのフォルダーに画像を保存できる", own.error === null, own.error?.message);
      const other = await a.client.storage.from("map-images").upload(`${mapB}/check.png`, png, { contentType: "image/png" });
      check("他人のマップのフォルダーには保存できない", other.error !== null);
      await admin.storage.from("map-images").remove([`${mapA}/check.png`, `${mapB}/check.png`]);
    }
  } finally {
    console.log("\n後片付け：確認用の管理者を削除");
    for (const user of users) {
      // profiles → maps → 配下のデータも連鎖して削除される
      await admin.auth.admin.deleteUser(user.id);
    }
  }

  console.log(`\n結果：OK ${passed} 件 ／ NG ${failed} 件`);
  if (failed > 0) process.exitCode = 1;
}

await main();
