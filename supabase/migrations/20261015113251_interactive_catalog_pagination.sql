create or replace function public.browse_catalog(
  p_category text,
  p_page integer default 1,
  p_page_size integer default 24,
  p_query text default null,
  p_genre text default null,
  p_year integer default null,
  p_year_unknown boolean default false,
  p_origin text default null,
  p_format text default null,
  p_sort text default 'recent',
  p_by_year boolean default false
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 24), 1), 48);
  v_result jsonb;
begin
  if p_category not in ('series', 'games', 'anime', 'novelas', 'dramas') then
    raise exception 'Catégorie invalide';
  end if;
  if coalesce(p_sort, 'recent') not in ('recent', 'az', 'za', 'year-desc', 'year-asc') then
    raise exception 'Tri invalide';
  end if;
  if p_origin is not null and p_origin not in ('korean-drama', 'chinese-drama') then
    raise exception 'Origine invalide';
  end if;
  if p_format is not null and p_format not in ('series', 'film') then
    raise exception 'Format invalide';
  end if;

  with scoped as materialized (
    select ci.*
    from public.catalog_items as ci
    where ci.active is true
      and ci.category = p_category
      and (p_origin is null or ci.media_type = p_origin)
      and (p_format is null or (p_format = 'film' and ci.media_format = 'film') or (p_format = 'series' and ci.media_format is distinct from 'film'))
  ), filtered as materialized (
    select s.*
    from scoped as s
    where (nullif(btrim(p_query), '') is null
      or strpos(lower(s.title), lower(btrim(p_query))) > 0
      or exists (select 1 from unnest(s.genres) as g(name) where strpos(lower(g.name), lower(btrim(p_query))) > 0))
      and (p_genre is null or p_genre = any(s.genres))
      and (p_year is null or s.year = p_year)
      and (not coalesce(p_year_unknown, false) or s.year is null)
  ), page_rows as (
    select f.*
    from filtered as f
    order by
      case when coalesce(p_sort, 'recent') = 'recent' and not coalesce(p_by_year, false) then f.created_at end desc nulls last,
      case when coalesce(p_sort, 'recent') = 'az' then lower(f.title) end asc,
      case when coalesce(p_sort, 'recent') = 'za' then lower(f.title) end desc,
      case when coalesce(p_sort, 'recent') = 'year-desc' or coalesce(p_by_year, false) then f.year end desc nulls last,
      case when coalesce(p_sort, 'recent') = 'year-asc' and not coalesce(p_by_year, false) then f.year end asc nulls last,
      lower(f.title) asc,
      f.id asc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(pr) order by
      case when coalesce(p_sort, 'recent') = 'recent' and not coalesce(p_by_year, false) then pr.created_at end desc nulls last,
      case when coalesce(p_sort, 'recent') = 'az' then lower(pr.title) end asc,
      case when coalesce(p_sort, 'recent') = 'za' then lower(pr.title) end desc,
      case when coalesce(p_sort, 'recent') = 'year-desc' or coalesce(p_by_year, false) then pr.year end desc nulls last,
      case when coalesce(p_sort, 'recent') = 'year-asc' and not coalesce(p_by_year, false) then pr.year end asc nulls last,
      lower(pr.title), pr.id) from page_rows as pr), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'summary', jsonb_build_object(
      'count', (select count(*) from scoped),
      'seasons', (select coalesce(sum(s.seasons_count), 0) from scoped as s),
      'size', (select coalesce(sum(s.game_size_gb), 0) from scoped as s),
      'genres', (select count(distinct g.name) from scoped as s cross join lateral unnest(s.genres) as g(name))
    ),
    'years', coalesce((select jsonb_agg(y.year order by y.year desc) from (select distinct s.year from scoped as s where s.year is not null) as y), '[]'::jsonb),
    'genres', coalesce((select jsonb_agg(jsonb_build_object('name', g.name, 'count', g.title_count) order by g.title_count desc, g.name asc)
      from (select unnest(s.genres) as name, count(*) as title_count from scoped as s group by 1) as g), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.browse_catalog(text, integer, integer, text, text, integer, boolean, text, text, text, boolean) from public;
grant execute on function public.browse_catalog(text, integer, integer, text, text, integer, boolean, text, text, text, boolean) to anon, authenticated;
