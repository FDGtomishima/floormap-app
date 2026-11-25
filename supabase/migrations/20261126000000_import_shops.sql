-- =====================================================================
-- 工程 4-1：店舗情報の一括登録（Excel 取り込みの確定）
--
-- 適用方法：Supabase 管理画面 → SQL Editor に全文を貼り付けて実行する。
--
--   import_shops(マップ id, 行の配列)：区画ごとに店舗を登録、すでにあれば更新する。
--   * 呼び出した管理者の権限で動く（security invoker）。RLS がそのまま効くので、本人のマップ以外には書けない
--   * 全行を1つのトランザクションで登録する（途中で失敗したら1件も登録しない）
--   * 画像（image_path）は変えない（画像の照合と登録は工程 4-2）
--   * 行の中身のチェック（区画番号の書式、店名、リンクなど）はサーバー側の処理（src/lib/shop-import.ts）で済ませてから呼ぶ
--
-- 行の形：{"section_id": uuid, "name": text, "genre_id": uuid|null, "hours": text|null,
--          "description": text|null, "sns_links": [text, ...]}
-- 戻り値：新規の件数と更新の件数
-- =====================================================================

create function public.import_shops(p_map_id uuid, p_rows jsonb)
returns table (created_count integer, updated_count integer)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_section_map uuid;
  v_inserted boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not public.is_map_owner(p_map_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_rows' using errcode = 'P0001';
  end if;

  created_count := 0;
  updated_count := 0;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    -- 区画はこのマップのものだけ
    select s.map_id into v_section_map from public.sections s where s.id = (v_row ->> 'section_id')::uuid;
    if v_section_map is distinct from p_map_id then
      raise exception 'section_not_found' using errcode = 'P0001';
    end if;

    insert into public.shops (section_id, name, genre_id, hours, description, sns_links)
    values (
      (v_row ->> 'section_id')::uuid,
      v_row ->> 'name',
      nullif(v_row ->> 'genre_id', '')::uuid,
      v_row ->> 'hours',
      v_row ->> 'description',
      coalesce(array(select jsonb_array_elements_text(coalesce(v_row -> 'sns_links', '[]'::jsonb))), '{}')
    )
    on conflict (section_id) do update
      set name = excluded.name,
          genre_id = excluded.genre_id,
          hours = excluded.hours,
          description = excluded.description,
          sns_links = excluded.sns_links
    returning (xmax = 0) into v_inserted;

    if v_inserted then
      created_count := created_count + 1;
    else
      updated_count := updated_count + 1;
    end if;
  end loop;

  return next;
end;
$$;

revoke all on function public.import_shops(uuid, jsonb) from public, anon;
grant execute on function public.import_shops(uuid, jsonb) to authenticated;
