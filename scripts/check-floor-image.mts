// 工程 2-2 の確認用スクリプト：フロア画像の設定（set_floor_image）と使用容量（refresh_image_usage）
//
// 実行：npm run check:floor-image
//
// 確認用の管理者2人と、容量上限の小さい確認用プランを作り、終わったらすべて削除する（メールは送られない）。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  throw new Error(".env.local に Supabase の値が入っていません");
}

const BUCKET = "map-images";
const TEST_PLAN = `check-tiny-${randomUUID().slice(0, 8)}`;
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

type TestUser = { id: string; client: SupabaseClient; mapId: string; floorId: string };

async function createTestUser(label: string): Promise<TestUser> {
  const email = `img-check-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`ユーザー作成に失敗：${created.error?.message}`);
  const client = createClient(url!, anonKey!, authOptions);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`ログインに失敗：${signedIn.error.message}`);

  const { data: mapId, error } = await client.rpc("create_map", { p_name: "画像確認用" });
  if (error) throw new Error(`マップ作成に失敗：${error.message}`);
  const { data: building } = await client.from("buildings").select("id").eq("map_id", mapId).single();
  const { data: floor, error: floorError } = await client
    .from("floors")
    .insert({ building_id: (building as { id: string }).id, code: "1", name: "1階" })
    .select("id")
    .single();
  if (floorError) throw new Error(`フロア作成に失敗：${floorError.message}`);
  return { id: created.data.user.id, client, mapId: String(mapId), floorId: (floor as { id: string }).id };
}

async function put(user: TestUser, path: string, bytes: number): Promise<void> {
  const { error } = await user.client.storage.from(BUCKET).upload(path, new Uint8Array(bytes), { contentType: "image/webp" });
  if (error) throw new Error(`アップロードに失敗：${error.message}`);
}

async function setImage(user: TestUser, floorId: string, display: string, edit: string) {
  return user.client.rpc("set_floor_image", {
    p_floor_id: floorId,
    p_image_path: display,
    p_edit_image_path: edit,
    p_width: 800,
    p_height: 600,
  });
}

async function usageBytes(user: TestUser): Promise<number> {
  const { data } = await user.client.from("usage").select("image_bytes").single();
  return Number((data as { image_bytes: number } | null)?.image_bytes ?? -1);
}

async function main(): Promise<void> {
  const users: TestUser[] = [];
  try {
    console.log("準備：確認用の管理者A・B、マップ、フロアを作成");
    const a = await createTestUser("a");
    users.push(a);
    const b = await createTestUser("b");
    users.push(b);
    const folder = `${a.mapId}/floors/${a.floorId}`;

    console.log("\n画像の設定");
    {
      const direct = await a.client.from("floors").update({ image_path: `${folder}/x.webp` }).eq("id", a.floorId);
      check("画像のパスは画面から直接変更できない", direct.error !== null);

      const missing = await setImage(a, a.floorId, `${folder}/none-display.webp`, `${folder}/none-edit.webp`);
      check("Storage にない画像は設定できない", missing.error?.message === "image_not_found");

      await put(a, `${a.mapId}/other.webp`, 10);
      const outside = await setImage(a, a.floorId, `${a.mapId}/other.webp`, `${a.mapId}/other.webp`);
      check("フロアのフォルダー以外の画像は設定できない", outside.error?.message === "invalid_image");
      await a.client.storage.from(BUCKET).remove([`${a.mapId}/other.webp`]);

      await put(a, `${folder}/1-display.webp`, 1000);
      await put(a, `${folder}/1-edit.webp`, 3000);
      const first = await setImage(a, a.floorId, `${folder}/1-display.webp`, `${folder}/1-edit.webp`);
      check("画像を設定できる", first.error === null, first.error?.message);
      const { data: floor } = await a.client.from("floors").select("image_path, edit_image_path, image_width").eq("id", a.floorId).single();
      const row = floor as { image_path: string; edit_image_path: string; image_width: number } | null;
      check("フロアに画像のパスと大きさが保存される", row?.edit_image_path === `${folder}/1-edit.webp` && row?.image_width === 800);

      await a.client.rpc("refresh_image_usage");
      check("使用容量が数え直される（4000バイト）", (await usageBytes(a)) === 4000, String(await usageBytes(a)));

      const other = await setImage(b, a.floorId, `${folder}/1-display.webp`, `${folder}/1-edit.webp`);
      check("他人のフロアには設定できない", other.error?.message === "not_found");
    }

    console.log("\n画像の差し替え");
    {
      await put(a, `${folder}/2-display.webp`, 500);
      await put(a, `${folder}/2-edit.webp`, 1500);
      const replaced = await setImage(a, a.floorId, `${folder}/2-display.webp`, `${folder}/2-edit.webp`);
      const old = ((replaced.data ?? []) as { old_image_path: string | null; old_edit_image_path: string | null }[])[0];
      check(
        "差し替えると前の画像のパスが返る",
        old?.old_image_path === `${folder}/1-display.webp` && old?.old_edit_image_path === `${folder}/1-edit.webp`,
      );
      await a.client.storage.from(BUCKET).remove([`${folder}/1-display.webp`, `${folder}/1-edit.webp`]);
      await a.client.rpc("refresh_image_usage");
      check("前の画像を消すと使用容量が減る（2000バイト）", (await usageBytes(a)) === 2000, String(await usageBytes(a)));
    }

    console.log("\n容量の上限");
    {
      await admin.from("plans").insert({ id: TEST_PLAN, name: "確認用", max_maps: 1, max_ai_runs: 0, max_image_bytes: 3000 });
      await admin.from("profiles").update({ plan_id: TEST_PLAN }).eq("id", a.id);

      // 差し替え：古い画像（2000）が消える分を引いて判定する。新 2500 → 2500 ≦ 3000 なので可
      await put(a, `${folder}/3-display.webp`, 1000);
      await put(a, `${folder}/3-edit.webp`, 1500);
      const within = await setImage(a, a.floorId, `${folder}/3-display.webp`, `${folder}/3-edit.webp`);
      check("差し替えで消える分を引いて上限内なら設定できる", within.error === null, within.error?.message);
      await a.client.storage.from(BUCKET).remove([`${folder}/2-display.webp`, `${folder}/2-edit.webp`]);

      // 新 4000 → 4000 > 3000 なので不可
      await put(a, `${folder}/4-display.webp`, 1500);
      await put(a, `${folder}/4-edit.webp`, 2500);
      const over = await setImage(a, a.floorId, `${folder}/4-display.webp`, `${folder}/4-edit.webp`);
      check("上限を超える画像は設定できない", over.error?.message === "limit_exceeded");

      await admin.from("profiles").update({ plan_id: "free" }).eq("id", a.id);
    }
  } finally {
    console.log("\n後片付け：画像・確認用の管理者・確認用プランを削除");
    for (const user of users) {
      const folder = `${user.mapId}/floors/${user.floorId}`;
      const { data: files } = await admin.storage.from(BUCKET).list(folder);
      const paths = (files ?? []).map((f) => `${folder}/${f.name}`);
      if (paths.length > 0) await admin.storage.from(BUCKET).remove(paths);
      await admin.auth.admin.deleteUser(user.id);
    }
    await admin.from("plans").delete().eq("id", TEST_PLAN);
  }

  console.log(`\n結果：OK ${passed} 件 ／ NG ${failed} 件`);
  if (failed > 0) process.exitCode = 1;
}

await main();
