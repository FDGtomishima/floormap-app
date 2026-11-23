-- =====================================================================
-- 工程 1-4：マップ作成 ／ 工程 1-5：利用上限チェック（共通処理）
--
-- 適用方法：Supabase 管理画面 → SQL Editor に全文を貼り付けて実行する。
--
--   * check_usage_limit(種類, 量)：plans の上限と現在値を比べて、実行できるかを返す（F-15）
--       種類：'map'（マップ数）／'ai'（AI実行回数）／'image'（画像容量。量はバイト数）
--   * create_map(マップ名)：上限を確認してマップを作り、初期ジャンル6件と建物1件を登録する（F-02）
--   どちらもログイン中の管理者本人についてだけ動く
-- =====================================================================

-- ---------------------------------------------------------------------
-- 利用上限の確認（F-15）
-- ---------------------------------------------------------------------
create function public.check_usage_limit(p_kind text, p_amount bigint default 1)
returns table (allowed boolean, current_value bigint, limit_value bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_max_maps integer;
  v_max_ai_runs integer;
  v_max_image_bytes bigint;
  v_suspended boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  select pl.max_maps, pl.max_ai_runs, pl.max_image_bytes, pr.is_suspended
    into v_max_maps, v_max_ai_runs, v_max_image_bytes, v_suspended
    from public.profiles pr
    join public.plans pl on pl.id = pr.plan_id
   where pr.id = v_uid;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0001';
  end if;

  case p_kind
    when 'map' then
      limit_value := v_max_maps;
      select count(*) into current_value from public.maps where owner_id = v_uid;
    when 'ai' then
      limit_value := v_max_ai_runs;
      select u.ai_runs into current_value from public.usage u where u.profile_id = v_uid;
    when 'image' then
      limit_value := v_max_image_bytes;
      select u.image_bytes into current_value from public.usage u where u.profile_id = v_uid;
    else
      raise exception 'invalid_kind' using errcode = 'P0001';
  end case;

  current_value := coalesce(current_value, 0);
  -- 上限が NULL なら上限なし。停止中のアカウントは何もできない
  allowed := not v_suspended and (limit_value is null or current_value + p_amount <= limit_value);
  return next;
end;
$$;

revoke all on function public.check_usage_limit(text, bigint) from public, anon;
grant execute on function public.check_usage_limit(text, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- マップコードの生成：英大文字と数字から、紛らわしい文字（O/0、I/1/L）を除いた6文字
-- ---------------------------------------------------------------------
create function public.generate_map_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_len constant integer := 6;
  v_bytes bytea := uuid_send(gen_random_uuid());  -- 暗号論的に安全な乱数
  v_code text := '';
begin
  for i in 0 .. v_len - 1 loop
    v_code := v_code || substr(v_chars, (get_byte(v_bytes, i) % length(v_chars)) + 1, 1);
  end loop;
  return v_code;
end;
$$;

revoke all on function public.generate_map_code() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- マップ作成（F-02）
--   エラーはメッセージで種類を返す：not_authenticated / email_not_confirmed /
--   account_suspended / limit_exceeded / invalid_name
-- ---------------------------------------------------------------------
create function public.create_map(p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_name text := btrim(coalesce(p_name, ''));
  v_limit record;
  v_map_id uuid;
  v_attempt integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- 同時に作成されても上限を超えないよう、本人の行をロックしてから数える
  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not v_profile.email_confirmed then
    raise exception 'email_not_confirmed' using errcode = 'P0001';
  end if;
  if v_profile.is_suspended then
    raise exception 'account_suspended' using errcode = 'P0001';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 100 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;

  select * into v_limit from public.check_usage_limit('map', 1);
  if not v_limit.allowed then
    raise exception 'limit_exceeded' using errcode = 'P0001';
  end if;

  -- マップコードが重複したら作り直す
  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.maps (owner_id, name, code)
      values (v_uid, v_name, public.generate_map_code())
      returning id into v_map_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 20 then
        raise;
      end if;
    end;
  end loop;

  -- 初期ジャンル（色は docs/03_ui-design.md のジャンル色）
  insert into public.genres (map_id, name, name_i18n, fill_color, line_color, text_color, sort_order)
  values
    (v_map_id, '飲食', '{"en":"Food & Drink","zh-Hans":"餐饮","zh-Hant":"餐飲"}', '#FFE8D6', '#E8833A', '#8A4210', 1),
    (v_map_id, '物販', '{"en":"Shopping","zh-Hans":"购物","zh-Hant":"購物"}', '#DCEBFF', '#3B82F6', '#1E4E9C', 2),
    (v_map_id, '展示', '{"en":"Exhibition","zh-Hans":"展览","zh-Hant":"展覽"}', '#EDE4FF', '#8B5CF6', '#5B2EB8', 3),
    (v_map_id, '体験・ワークショップ', '{"en":"Experience & Workshop","zh-Hans":"体验・工作坊","zh-Hant":"體驗・工作坊"}', '#D9F5EA', '#10B981', '#0B6B4C', 4),
    (v_map_id, 'サービス', '{"en":"Services","zh-Hans":"服务","zh-Hant":"服務"}', '#FFE1EC', '#EC4899', '#9D174D', 5),
    (v_map_id, '施設', '{"en":"Facilities","zh-Hans":"设施","zh-Hant":"設施"}', '#ECEEF1', '#9AA3AE', '#4B5563', 6);

  -- 建物は1つでも1件作る
  insert into public.buildings (map_id, code, name, sort_order)
  values (v_map_id, 'A', 'A棟', 1);

  return v_map_id;
end;
$$;

revoke all on function public.create_map(text) from public, anon;
grant execute on function public.create_map(text) to authenticated;
