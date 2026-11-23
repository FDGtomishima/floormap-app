-- =====================================================================
-- 工程 2-2：フロア画像のアップロード
--
-- 適用方法：Supabase 管理画面 → SQL Editor に全文を貼り付けて実行する。
--
-- 流れ（F-04）
--   1. ブラウザで画像を縮小・圧縮（表示用と編集用）
--   2. 容量の上限を確認（check_usage_limit）
--   3. Storage に保存：map-images/{map_id}/floors/{floor_id}/…（RLS で本人のマップのフォルダーだけ）
--   4. set_floor_image でフロアに設定。ファイルが本当にあるか・容量の上限を超えないかをここで必ず確認する
--   5. 古い画像を Storage から消し、refresh_image_usage で使用容量を数え直す
--
-- 使用容量（usage.image_bytes）は足し引きではなく、Storage にある本人のマップのフロア画像の合計を
-- 数え直して保存する（途中で失敗しても値がずれないようにするため）
-- =====================================================================

-- ---------------------------------------------------------------------
-- 本人のマップのフロア画像の合計サイズ（バイト）
-- ---------------------------------------------------------------------
create function public.floor_image_bytes(p_uid uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
    from storage.objects o
   where o.bucket_id = 'map-images'
     and split_part(o.name, '/', 2) = 'floors'
     and split_part(o.name, '/', 1) in (select m.id::text from public.maps m where m.owner_id = p_uid);
$$;

revoke all on function public.floor_image_bytes(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 使用容量を数え直して usage に保存する（ログイン中の管理者本人の分）
-- ---------------------------------------------------------------------
create function public.refresh_image_usage()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_total bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  v_total := public.floor_image_bytes(v_uid);
  update public.usage set image_bytes = v_total where profile_id = v_uid;
  return v_total;
end;
$$;

revoke all on function public.refresh_image_usage() from public, anon;
grant execute on function public.refresh_image_usage() to authenticated;

-- ---------------------------------------------------------------------
-- フロアに画像を設定する。前の画像のパスを返す（呼び出し側で Storage から消す）
--   エラー：not_authenticated / not_found / invalid_image / image_not_found / limit_exceeded
-- ---------------------------------------------------------------------
create function public.set_floor_image(
  p_floor_id uuid,
  p_image_path text,
  p_edit_image_path text,
  p_width integer,
  p_height integer
)
returns table (old_image_path text, old_edit_image_path text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_floor public.floors;
  v_prefix text;
  v_limit bigint;
  v_total bigint;
  v_old_bytes bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select * into v_floor from public.floors where id = p_floor_id for update;
  if not found or not public.is_map_owner(v_floor.map_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  if p_width is null or p_height is null or p_width < 1 or p_height < 1 or p_width > 10000 or p_height > 10000 then
    raise exception 'invalid_image' using errcode = 'P0001';
  end if;

  -- 画像はこのフロアのフォルダーに保存されたものだけ
  v_prefix := v_floor.map_id::text || '/floors/' || v_floor.id::text || '/';
  if p_image_path is null or p_edit_image_path is null
     or left(p_image_path, length(v_prefix)) <> v_prefix
     or left(p_edit_image_path, length(v_prefix)) <> v_prefix
     or p_image_path like '%..%' or p_edit_image_path like '%..%' then
    raise exception 'invalid_image' using errcode = 'P0001';
  end if;

  if (select count(*) from storage.objects o
       where o.bucket_id = 'map-images' and o.name in (p_image_path, p_edit_image_path)) <> 2 then
    raise exception 'image_not_found' using errcode = 'P0001';
  end if;

  -- 容量の上限：新しい画像はすでに Storage にあるので、合計から差し替えで消える古い画像の分を引いて比べる
  select pl.max_image_bytes into v_limit
    from public.profiles pr join public.plans pl on pl.id = pr.plan_id
   where pr.id = v_uid;
  if v_limit is not null then
    v_total := public.floor_image_bytes(v_uid);
    select coalesce(sum((o.metadata ->> 'size')::bigint), 0) into v_old_bytes
      from storage.objects o
     where o.bucket_id = 'map-images'
       and o.name in (coalesce(v_floor.image_path, ''), coalesce(v_floor.edit_image_path, ''))
       and o.name not in (p_image_path, p_edit_image_path);
    if v_total - v_old_bytes > v_limit then
      raise exception 'limit_exceeded' using errcode = 'P0001';
    end if;
  end if;

  update public.floors
     set image_path = p_image_path,
         edit_image_path = p_edit_image_path,
         image_width = p_width,
         image_height = p_height
   where id = p_floor_id;

  old_image_path := nullif(v_floor.image_path, p_image_path);
  old_edit_image_path := nullif(v_floor.edit_image_path, p_edit_image_path);
  return next;
end;
$$;

revoke all on function public.set_floor_image(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.set_floor_image(uuid, text, text, integer, integer) to authenticated;

-- 画像のパスとサイズは set_floor_image からだけ変更する（ファイルの存在と容量を確認するため）
revoke update on public.floors from authenticated;
grant update (code, name, sort_order) on public.floors to authenticated;
revoke insert on public.floors from authenticated;
grant insert (building_id, map_id, code, name, sort_order) on public.floors to authenticated;
