-- One transaction saves the season and makes it available on its parent title.
create function public.save_catalog_season(p_item_id uuid, p_values jsonb, p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  parent public.catalog_items;
  previous public.catalog_seasons;
  saved public.catalog_seasons;
  numbers integer[];
  season_number integer;
begin
  if not exists (select 1 from public.app_admins where user_id = (select auth.uid())) then
    raise exception 'Administrator membership required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_values) is distinct from 'object' then raise exception 'Invalid season'; end if;
  season_number := (p_values ->> 'number')::integer;
  if season_number is null or season_number not between 1 and 999 then raise exception 'Invalid season number'; end if;
  select * into parent from public.catalog_items where id = p_item_id for update;
  if not found then raise exception 'Catalog item not found'; end if;
  if parent.category not in ('series', 'anime') or parent.media_format = 'film' then raise exception 'Not a seasonal title'; end if;
  select * into previous from public.catalog_seasons where item_id = p_item_id and number = season_number for update;
  if previous.updated_at is distinct from p_expected_updated_at then
    raise exception 'This season changed. Reload it before saving.' using errcode = '40001';
  end if;
  insert into public.catalog_seasons (item_id, number, title, synopsis, poster_url, year, source, source_id, source_url, manual, updated_at)
    values (p_item_id, season_number, nullif(btrim(p_values ->> 'title'), ''), nullif(btrim(p_values ->> 'synopsis'), ''),
      nullif(btrim(p_values ->> 'poster_url'), ''), (p_values ->> 'year')::integer,
      p_values ->> 'source', p_values ->> 'source_id', p_values ->> 'source_url',
      previous.item_id is not null or nullif(btrim(p_values ->> 'title'), '') is not null
        or nullif(btrim(p_values ->> 'synopsis'), '') is not null or nullif(btrim(p_values ->> 'poster_url'), '') is not null
        or (p_values ->> 'year') is not null, clock_timestamp())
    on conflict (item_id, number) do update set title = excluded.title, synopsis = excluded.synopsis,
      poster_url = excluded.poster_url, year = excluded.year, source = excluded.source, source_id = excluded.source_id,
      source_url = excluded.source_url, manual = excluded.manual, updated_at = excluded.updated_at returning * into saved;
  numbers := parent.available_seasons;
  if numbers is null then
    select coalesce(array_agg(n), '{}'::integer[]) into numbers from generate_series(1, coalesce(parent.seasons_count, 0)) n;
  end if;
  select array_agg(distinct n order by n) into numbers from unnest(numbers || season_number) n;
  update public.catalog_items set available_seasons = numbers, seasons_count = cardinality(numbers),
    season_details_checked_at = case when season_number = any(coalesce(parent.available_seasons, '{}'::integer[])) then season_details_checked_at else null end
    where id = p_item_id returning * into parent;
  return jsonb_build_object('item', to_jsonb(parent), 'season', to_jsonb(saved));
end $$;
revoke execute on function public.save_catalog_season(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.save_catalog_season(uuid, jsonb, timestamptz) to authenticated;
