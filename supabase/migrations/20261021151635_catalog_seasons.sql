alter table public.catalog_items
  add column if not exists available_seasons integer[] default null,
  add column if not exists season_details_checked_at timestamptz default null,
  add column if not exists season_details_note text default null;

alter table public.catalog_items add constraint available_seasons_valid check (
  available_seasons is null or (cardinality(available_seasons) between 1 and 999
    and 0 < all(available_seasons) and 1000 > all(available_seasons)
    and array_position(available_seasons, null) is null)
);

create table public.catalog_seasons (
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  number integer not null check (number between 1 and 999),
  title text check (char_length(title) <= 300),
  synopsis text check (char_length(synopsis) <= 15000),
  poster_url text check (poster_url is null or poster_url ~ '^https://'),
  year integer check (year between 1850 and 2200),
  source text, source_id text, source_url text check (source_url is null or source_url ~ '^https://'),
  manual boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (item_id, number)
);
alter table public.catalog_seasons enable row level security;
revoke all on public.catalog_seasons from public, anon, authenticated;
grant select on public.catalog_seasons to anon, authenticated;
grant insert, update, delete on public.catalog_seasons to authenticated;
create policy "Visible seasons" on public.catalog_seasons for select to anon, authenticated
  using (exists (select 1 from public.catalog_items i where i.id = item_id));
create policy "Administrators write seasons" on public.catalog_seasons for all to authenticated
  using (exists (select 1 from public.app_admins where user_id = (select auth.uid())))
  with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));

-- Invoker rights and existing administrator membership protect both writes.
-- The parent lock and version check preserve edits made while a lookup runs.
create function public.complete_catalog_seasons(p_item_id uuid, p_rows jsonb, p_expected_updated_at timestamptz, p_note text default null)
returns public.catalog_items language plpgsql security invoker set search_path = '' as $$
declare parent public.catalog_items;
begin
  if not exists (select 1 from public.app_admins where user_id = (select auth.uid())) then
    raise exception 'Administrator membership required' using errcode = '42501';
  end if;
  select * into parent from public.catalog_items where id = p_item_id for update;
  if not found then raise exception 'Catalog item not found'; end if;
  if parent.updated_at is distinct from p_expected_updated_at then
    raise exception 'The item changed during season lookup. Retry without losing the saved edits.' using errcode = '40001';
  end if;
  if parent.category not in ('series', 'anime') or parent.media_format = 'film' then raise exception 'Not a seasonal title'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 999 then raise exception 'Invalid seasons'; end if;
  insert into public.catalog_seasons as saved (item_id, number, title, synopsis, poster_url, year, source, source_id, source_url)
    select p_item_id, r.number, nullif(r.title, ''), nullif(r.synopsis, ''), r.poster_url, r.year, r.source, r.source_id, r.source_url
    from jsonb_to_recordset(p_rows) as r(number integer, title text, synopsis text, poster_url text, year integer, source text, source_id text, source_url text)
    on conflict (item_id, number) do update set
      title = coalesce(saved.title, excluded.title), synopsis = coalesce(saved.synopsis, excluded.synopsis), poster_url = coalesce(saved.poster_url, excluded.poster_url),
      year = coalesce(saved.year, excluded.year), source = coalesce(saved.source, excluded.source),
      source_id = coalesce(saved.source_id, excluded.source_id), source_url = coalesce(saved.source_url, excluded.source_url), updated_at = now()
    where not saved.manual;
  update public.catalog_items set season_details_checked_at = now(), season_details_note = left(p_note, 1000)
    where id = p_item_id returning * into parent;
  return parent;
end $$;
revoke execute on function public.complete_catalog_seasons(uuid, jsonb, timestamptz, text) from public, anon;
grant execute on function public.complete_catalog_seasons(uuid, jsonb, timestamptz, text) to authenticated;
