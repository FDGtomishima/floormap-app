-- =====================================================================
-- 工程 1-2：テーブル作成と行単位の権限（RLS）
--
-- 適用方法：Supabase 管理画面 → SQL Editor に全文を貼り付けて実行する。
--
-- 方針
--   * 管理者は自分のマップ（とその配下）だけを読み書きできる。RLS で必ず守る
--   * 閲覧者（未ログイン＝anon）には下書きのテーブルを一切見せない。
--     閲覧画面は公開版（map_publications）だけを、サーバー側の処理経由で読む（工程 5-1）
--   * 子テーブル（floors / sections / shops / shop_translations）にも map_id を持たせ、
--     親から自動で設定する（画面から送られた値は使わない）。権限の判定を単純にするため
--   * マップの作成・公開・利用状況の加算は、上限チェックを伴うためサーバー側の処理で行う。
--     画面から maps / map_publications / usage へ直接 INSERT はできない
--   * 上限の値は plans テーブルで管理する。NULL は「上限なし」
-- =====================================================================

-- ---------------------------------------------------------------------
-- 種類（enum）
-- ---------------------------------------------------------------------
create type public.publish_status as enum ('private', 'public', 'limited');
create type public.section_source as enum ('manual', 'ai');
create type public.translation_lang as enum ('en', 'zh-Hans', 'zh-Hant');
create type public.translation_method as enum ('ai', 'manual');

-- ---------------------------------------------------------------------
-- 共通：updated_at の自動更新
-- ---------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- plans（プラン）
-- ---------------------------------------------------------------------
create table public.plans (
  id text primary key,
  name text not null,
  max_maps integer check (max_maps >= 0),               -- NULL＝上限なし
  max_ai_runs integer check (max_ai_runs >= 0),         -- NULL＝上限なし
  max_image_bytes bigint check (max_image_bytes >= 0),  -- NULL＝上限なし
  price_jpy integer not null default 0 check (price_jpy >= 0),
  created_at timestamptz not null default now()
);

-- 無料プラン。画像容量の上限は未決定のため NULL（上限なし）
insert into public.plans (id, name, max_maps, max_ai_runs, max_image_bytes, price_jpy)
values ('free', '無料プラン', 1, 1, null, 0);

-- ---------------------------------------------------------------------
-- profiles（管理者）
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  email_confirmed boolean not null default false,
  plan_id text not null default 'free' references public.plans (id),
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- usage（利用状況）
-- ---------------------------------------------------------------------
create table public.usage (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  ai_runs integer not null default 0 check (ai_runs >= 0),
  image_bytes bigint not null default 0 check (image_bytes >= 0),
  updated_at timestamptz not null default now()
);

create trigger usage_set_updated_at
  before update on public.usage
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Auth のユーザー登録・更新に合わせて profiles / usage を作成・同期する
-- ---------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, email_confirmed)
  values (new.id, coalesce(new.email, ''), new.email_confirmed_at is not null);

  insert into public.usage (profile_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email = coalesce(new.email, ''),
         email_confirmed = new.email_confirmed_at is not null
   where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of email, email_confirmed_at on auth.users
  for each row execute function public.handle_user_updated();

-- ---------------------------------------------------------------------
-- maps（マップ）
-- ---------------------------------------------------------------------
create table public.maps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  -- マップコード：大文字英数字で保存する（入力時は大文字に変換して照合）
  code text not null unique check (code ~ '^[A-Z0-9]{4,12}$'),
  publish_status public.publish_status not null default 'private',
  publish_start_at timestamptz,
  publish_end_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maps_publish_period_order check (
    publish_start_at is null or publish_end_at is null or publish_start_at < publish_end_at
  ),
  constraint maps_limited_needs_period check (
    publish_status <> 'limited' or (publish_start_at is not null and publish_end_at is not null)
  )
);

create index maps_owner_id_idx on public.maps (owner_id);

create trigger maps_set_updated_at
  before update on public.maps
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 権限判定：ログイン中の管理者がこのマップの持ち主か（停止中のアカウントは不可）
-- security definer にして、RLS の判定の中で maps の RLS が再帰しないようにする
-- ---------------------------------------------------------------------
create function public.is_map_owner(p_map_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.maps m
      join public.profiles p on p.id = m.owner_id
     where m.id = p_map_id
       and m.owner_id = (select auth.uid())
       and not p.is_suspended
  );
$$;

revoke all on function public.is_map_owner(uuid) from public, anon;
grant execute on function public.is_map_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- genres（ジャンル）
-- ---------------------------------------------------------------------
create table public.genres (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  -- 各言語の名前（例：{"en": "Food", "zh-Hans": "餐饮", "zh-Hant": "餐飲"}）
  name_i18n jsonb not null default '{}'::jsonb check (jsonb_typeof(name_i18n) = 'object'),
  fill_color text not null check (fill_color ~ '^#[0-9A-Fa-f]{6}$'),
  line_color text not null check (line_color ~ '^#[0-9A-Fa-f]{6}$'),
  text_color text not null check (text_color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (map_id, name)
);

create index genres_map_id_idx on public.genres (map_id);

create trigger genres_set_updated_at
  before update on public.genres
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- buildings（建物・エリア）
-- ---------------------------------------------------------------------
create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps (id) on delete cascade,
  code text not null check (char_length(btrim(code)) between 1 and 10),  -- A、B、N など
  name text not null check (char_length(btrim(name)) between 1 and 50),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (map_id, code)
);

create index buildings_map_id_idx on public.buildings (map_id);

create trigger buildings_set_updated_at
  before update on public.buildings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- floors（フロア）
-- ---------------------------------------------------------------------
create table public.floors (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  map_id uuid not null references public.maps (id) on delete cascade,  -- building から自動設定
  code text not null check (char_length(btrim(code)) between 1 and 10),  -- 1、10、B1 など
  name text not null check (char_length(btrim(name)) between 1 and 50),
  sort_order integer not null default 0,
  -- Storage 内のパス（表示用と編集用の2サイズ）
  image_path text,
  edit_image_path text,
  -- 区画の座標の基準になる画像サイズ（編集用画像のピクセル）
  image_width integer check (image_width > 0),
  image_height integer check (image_height > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building_id, code)
);

create index floors_building_id_idx on public.floors (building_id);
create index floors_map_id_idx on public.floors (map_id);

create trigger floors_set_updated_at
  before update on public.floors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- sections（区画）
-- ---------------------------------------------------------------------
create table public.sections (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors (id) on delete cascade,
  map_id uuid not null references public.maps (id) on delete cascade,  -- floor から自動設定
  -- 区画番号。AI の下書きで読めなかったものは NULL（番号未設定）。
  -- 書式（A-101 など）は警告のみで保存は可のため、DB では書式を制限しない
  number text check (number is null or char_length(btrim(number)) between 1 and 20),
  -- 多角形の座標（画像のピクセル基準）例：[[120,80],[260,80],[260,190],[120,190]]
  points jsonb not null check (jsonb_typeof(points) = 'array'),
  source public.section_source not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 区画番号はマップ内で重複不可（NULL 同士は重複とみなさない）
  unique (map_id, number)
);

create index sections_floor_id_idx on public.sections (floor_id);

create trigger sections_set_updated_at
  before update on public.sections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- shops（店舗）。日本語が基本データ
-- ---------------------------------------------------------------------
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null unique references public.sections (id) on delete cascade,  -- 1区画に1店舗
  map_id uuid not null references public.maps (id) on delete cascade,  -- section から自動設定
  name text not null check (char_length(btrim(name)) between 1 and 100),
  genre_id uuid references public.genres (id) on delete set null,  -- NULL＝未分類
  hours text,
  description text,
  image_path text,
  sns_links text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shops_map_id_idx on public.shops (map_id);
create index shops_genre_id_idx on public.shops (genre_id);

create trigger shops_set_updated_at
  before update on public.shops
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- shop_translations（店舗の翻訳）
-- ---------------------------------------------------------------------
create table public.shop_translations (
  shop_id uuid not null references public.shops (id) on delete cascade,
  lang public.translation_lang not null,
  map_id uuid not null references public.maps (id) on delete cascade,  -- shop から自動設定
  name text,
  hours text,
  description text,
  method public.translation_method not null default 'ai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shop_id, lang)
);

create index shop_translations_map_id_idx on public.shop_translations (map_id);

create trigger shop_translations_set_updated_at
  before update on public.shop_translations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- map_publications（公開版）。閲覧画面はこれだけを読む
-- ---------------------------------------------------------------------
create table public.map_publications (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps (id) on delete cascade,
  published_at timestamptz not null default now(),
  data jsonb not null
);

create index map_publications_map_id_published_at_idx
  on public.map_publications (map_id, published_at desc);

-- ---------------------------------------------------------------------
-- 子テーブルの map_id を親から設定する（画面から送られた値は使わない）
-- ---------------------------------------------------------------------
create function public.set_floor_map_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select b.map_id into new.map_id from public.buildings b where b.id = new.building_id;
  return new;
end;
$$;

create trigger floors_set_map_id
  before insert or update on public.floors
  for each row execute function public.set_floor_map_id();

create function public.set_section_map_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select f.map_id into new.map_id from public.floors f where f.id = new.floor_id;
  return new;
end;
$$;

create trigger sections_set_map_id
  before insert or update on public.sections
  for each row execute function public.set_section_map_id();

create function public.set_shop_map_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select s.map_id into new.map_id from public.sections s where s.id = new.section_id;

  -- ジャンルは同じマップのものだけ
  if new.genre_id is not null and not exists (
    select 1 from public.genres g where g.id = new.genre_id and g.map_id = new.map_id
  ) then
    raise exception 'genre % does not belong to map %', new.genre_id, new.map_id
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger shops_set_map_id
  before insert or update on public.shops
  for each row execute function public.set_shop_map_id();

create function public.set_shop_translation_map_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select s.map_id into new.map_id from public.shops s where s.id = new.shop_id;
  return new;
end;
$$;

create trigger shop_translations_set_map_id
  before insert or update on public.shop_translations
  for each row execute function public.set_shop_translation_map_id();

-- =====================================================================
-- 行単位の権限（RLS）
-- =====================================================================
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.usage enable row level security;
alter table public.maps enable row level security;
alter table public.genres enable row level security;
alter table public.buildings enable row level security;
alter table public.floors enable row level security;
alter table public.sections enable row level security;
alter table public.shops enable row level security;
alter table public.shop_translations enable row level security;
alter table public.map_publications enable row level security;

-- 閲覧者（anon）には下書き・管理用のテーブルを一切見せない
revoke all on
  public.plans, public.profiles, public.usage, public.maps, public.genres,
  public.buildings, public.floors, public.sections, public.shops,
  public.shop_translations, public.map_publications
from anon;

-- ---- plans：ログイン中の管理者は読める（上限の表示用）。書き込みは運営者のみ
revoke insert, update, delete on public.plans from authenticated;
create policy "plans: 管理者は読める"
  on public.plans for select to authenticated
  using (true);

-- ---- profiles：本人の行だけ読める。プラン・停止状態を本人が変えられないよう、書き込みは不可
revoke insert, update, delete on public.profiles from authenticated;
create policy "profiles: 本人の行を読める"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

-- ---- usage：本人の行だけ読める。加算はサーバー側の処理だけが行う
revoke insert, update, delete on public.usage from authenticated;
create policy "usage: 本人の行を読める"
  on public.usage for select to authenticated
  using (profile_id = (select auth.uid()));

-- ---- maps：本人のマップだけ読める・変更・削除できる。
--      作成は上限チェックとマップコード生成を伴うためサーバー側の処理で行う（工程 1-4）。
--      持ち主とマップコードは画面から変えられない
revoke insert, update on public.maps from authenticated;
grant update (name, publish_status, publish_start_at, publish_end_at) on public.maps to authenticated;

create policy "maps: 本人のマップを読める"
  on public.maps for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "maps: 本人のマップを変更できる"
  on public.maps for update to authenticated
  using (public.is_map_owner(id))
  with check (public.is_map_owner(id));
create policy "maps: 本人のマップを削除できる"
  on public.maps for delete to authenticated
  using (public.is_map_owner(id));

-- ---- genres / buildings：本人のマップの行だけ読み書きできる。所属マップは変えられない
revoke update on public.genres from authenticated;
grant update (name, name_i18n, fill_color, line_color, text_color, sort_order) on public.genres to authenticated;

create policy "genres: 本人のマップの行を読める"
  on public.genres for select to authenticated
  using (public.is_map_owner(map_id));
create policy "genres: 本人のマップに追加できる"
  on public.genres for insert to authenticated
  with check (public.is_map_owner(map_id));
create policy "genres: 本人のマップの行を変更できる"
  on public.genres for update to authenticated
  using (public.is_map_owner(map_id))
  with check (public.is_map_owner(map_id));
create policy "genres: 本人のマップの行を削除できる"
  on public.genres for delete to authenticated
  using (public.is_map_owner(map_id));

revoke update on public.buildings from authenticated;
grant update (code, name, sort_order) on public.buildings to authenticated;

create policy "buildings: 本人のマップの行を読める"
  on public.buildings for select to authenticated
  using (public.is_map_owner(map_id));
create policy "buildings: 本人のマップに追加できる"
  on public.buildings for insert to authenticated
  with check (public.is_map_owner(map_id));
create policy "buildings: 本人のマップの行を変更できる"
  on public.buildings for update to authenticated
  using (public.is_map_owner(map_id))
  with check (public.is_map_owner(map_id));
create policy "buildings: 本人のマップの行を削除できる"
  on public.buildings for delete to authenticated
  using (public.is_map_owner(map_id));

-- ---- floors / sections / shops / shop_translations：
--      map_id はトリガーで親から設定されるため、親が本人のマップにあるかで判定される
revoke update on public.floors from authenticated;
grant update (code, name, sort_order, image_path, edit_image_path, image_width, image_height)
  on public.floors to authenticated;

create policy "floors: 本人のマップの行を読める"
  on public.floors for select to authenticated
  using (public.is_map_owner(map_id));
create policy "floors: 本人のマップに追加できる"
  on public.floors for insert to authenticated
  with check (public.is_map_owner(map_id));
create policy "floors: 本人のマップの行を変更できる"
  on public.floors for update to authenticated
  using (public.is_map_owner(map_id))
  with check (public.is_map_owner(map_id));
create policy "floors: 本人のマップの行を削除できる"
  on public.floors for delete to authenticated
  using (public.is_map_owner(map_id));

revoke update on public.sections from authenticated;
grant update (number, points, source) on public.sections to authenticated;

create policy "sections: 本人のマップの行を読める"
  on public.sections for select to authenticated
  using (public.is_map_owner(map_id));
create policy "sections: 本人のマップに追加できる"
  on public.sections for insert to authenticated
  with check (public.is_map_owner(map_id));
create policy "sections: 本人のマップの行を変更できる"
  on public.sections for update to authenticated
  using (public.is_map_owner(map_id))
  with check (public.is_map_owner(map_id));
create policy "sections: 本人のマップの行を削除できる"
  on public.sections for delete to authenticated
  using (public.is_map_owner(map_id));

revoke update on public.shops from authenticated;
grant update (name, genre_id, hours, description, image_path, sns_links) on public.shops to authenticated;

create policy "shops: 本人のマップの行を読める"
  on public.shops for select to authenticated
  using (public.is_map_owner(map_id));
create policy "shops: 本人のマップに追加できる"
  on public.shops for insert to authenticated
  with check (public.is_map_owner(map_id));
create policy "shops: 本人のマップの行を変更できる"
  on public.shops for update to authenticated
  using (public.is_map_owner(map_id))
  with check (public.is_map_owner(map_id));
create policy "shops: 本人のマップの行を削除できる"
  on public.shops for delete to authenticated
  using (public.is_map_owner(map_id));

revoke update on public.shop_translations from authenticated;
grant update (name, hours, description, method) on public.shop_translations to authenticated;

create policy "shop_translations: 本人のマップの行を読める"
  on public.shop_translations for select to authenticated
  using (public.is_map_owner(map_id));
create policy "shop_translations: 本人のマップに追加できる"
  on public.shop_translations for insert to authenticated
  with check (public.is_map_owner(map_id));
create policy "shop_translations: 本人のマップの行を変更できる"
  on public.shop_translations for update to authenticated
  using (public.is_map_owner(map_id))
  with check (public.is_map_owner(map_id));
create policy "shop_translations: 本人のマップの行を削除できる"
  on public.shop_translations for delete to authenticated
  using (public.is_map_owner(map_id));

-- ---- map_publications：本人は自分のマップの公開履歴を読める。
--      作成はサーバー側の「公開」処理だけが行う（工程 5-1）。閲覧者への提供もサーバー側から
revoke insert, update, delete on public.map_publications from authenticated;
create policy "map_publications: 本人のマップの公開版を読める"
  on public.map_publications for select to authenticated
  using (public.is_map_owner(map_id));

-- =====================================================================
-- Storage：画像用バケット（公開バケット）
--   パスは「{map_id}/...」とし、書き込みは本人のマップのフォルダーだけに制限する。
--   読み込みは公開URLで誰でも可能（閲覧者がログインなしで画像を見るため）
-- =====================================================================
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('map-images', 'map-images', true, array['image/png', 'image/jpeg', 'image/webp']);

-- パスの先頭フォルダーが本人のマップの id か
create function public.is_map_owner_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(p_name, '/', 1);
begin
  if v_folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return public.is_map_owner(v_folder::uuid);
end;
$$;

revoke all on function public.is_map_owner_path(text) from public, anon;
grant execute on function public.is_map_owner_path(text) to authenticated;

create policy "map-images: 本人のマップのフォルダーを読める"
  on storage.objects for select to authenticated
  using (bucket_id = 'map-images' and public.is_map_owner_path(name));
create policy "map-images: 本人のマップのフォルダーに追加できる"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'map-images' and public.is_map_owner_path(name));
create policy "map-images: 本人のマップのフォルダーを変更できる"
  on storage.objects for update to authenticated
  using (bucket_id = 'map-images' and public.is_map_owner_path(name))
  with check (bucket_id = 'map-images' and public.is_map_owner_path(name));
create policy "map-images: 本人のマップのフォルダーを削除できる"
  on storage.objects for delete to authenticated
  using (bucket_id = 'map-images' and public.is_map_owner_path(name));
