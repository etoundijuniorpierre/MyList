-- À exécuter une fois dans SQL Editor du projet Supabase.
create extension if not exists pgcrypto;

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,32}$'),
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('series', 'games', 'anime', 'novelas', 'dramas')),
  media_type text check (media_type in ('anime', 'chinese-drama', 'korean-drama')),
  title text not null check (length(trim(title)) > 0),
  title_key text not null,
  synopsis text,
  poster_url text,
  genres text[] not null default '{}',
  year integer check (year between 1850 and 2200),
  source text not null default 'manual',
  source_id text,
  source_url text,
  active boolean not null default true,
  seasons_count integer check (seasons_count is null or seasons_count between 1 and 999),
  game_size_gb numeric(12, 2) check (game_size_gb is null or game_size_gb > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_media_type_check check (
    (category = 'anime' and media_type = 'anime' and media_type is not null) or
    (category = 'dramas' and media_type is not null and media_type in ('chinese-drama', 'korean-drama')) or
    (category not in ('anime', 'dramas') and media_type is null)
  ),
  constraint catalog_measure_check check (
    (category = 'games' and seasons_count is null) or
    (category <> 'games' and game_size_gb is null)
  ),
  constraint catalog_poster_url_check check (poster_url is null or poster_url ~ '^https://'),
  constraint catalog_source_url_check check (source_url is null or source_url ~ '^https://')
);

create unique index if not exists catalog_title_unique on public.catalog_items (title_key);
create unique index if not exists catalog_source_unique on public.catalog_items (category, source, source_id) where source_id is not null;
create index if not exists catalog_category_active_idx on public.catalog_items (category, active, created_at desc);

create table if not exists public.price_rules (
  category text primary key check (category in ('series', 'anime', 'novelas', 'dramas')),
  standard_price numeric(12, 2) check (standard_price is null or standard_price >= 0),
  threshold_seasons integer check (threshold_seasons is null or threshold_seasons >= 2),
  threshold_price numeric(12, 2) check (threshold_price is null or threshold_price >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  updated_at timestamptz not null default now(),
  constraint price_pair_check check ((standard_price is null and currency is null) or (standard_price is not null and currency is not null)),
  constraint price_threshold_pair_check check ((threshold_seasons is null and threshold_price is null) or (threshold_seasons is not null and threshold_price is not null and standard_price is not null and threshold_price <= standard_price))
);

create table if not exists public.game_price_tiers (
  id uuid primary key default gen_random_uuid(),
  min_gb integer not null check (min_gb >= 1),
  max_gb integer not null check (max_gb >= min_gb),
  price numeric(12, 2) not null check (price >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.game_count_discount (
  id boolean primary key default true check (id),
  min_games integer check (min_games is null or min_games >= 2),
  price_per_game numeric(12, 2) check (price_per_game is null or price_per_game >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint game_discount_pair_check check ((min_games is null and price_per_game is null and currency is null) or (min_games is not null and price_per_game is not null and currency is not null))
);

-- Accessible seulement à la clé serveur des Edge Functions.
create table if not exists public.admin_login_attempts (
  attempt_key text primary key,
  attempts integer not null,
  window_started timestamptz not null
);

create or replace function public.admin_login_rate_limit(p_key text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare allowed boolean;
begin
  insert into public.admin_login_attempts (attempt_key, attempts, window_started)
  values (p_key, 1, now())
  on conflict (attempt_key) do update set
    attempts = case when public.admin_login_attempts.window_started < now() - interval '15 minutes' then 1 else public.admin_login_attempts.attempts + 1 end,
    window_started = case when public.admin_login_attempts.window_started < now() - interval '15 minutes' then now() else public.admin_login_attempts.window_started end
  returning attempts <= 8 into allowed;
  return allowed;
end;
$$;

revoke all on public.admin_login_attempts from public, anon, authenticated;
revoke all on function public.admin_login_rate_limit(text) from public, anon, authenticated;
grant select, insert, update on public.admin_login_attempts to service_role;
grant execute on function public.admin_login_rate_limit(text) to service_role;

insert into public.price_rules (category) values ('series'), ('anime'), ('novelas'), ('dramas') on conflict do nothing;
insert into public.game_count_discount (id) values (true) on conflict do nothing;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists catalog_items_updated_at on public.catalog_items;
create trigger catalog_items_updated_at before update on public.catalog_items
for each row execute function public.set_updated_at();
drop trigger if exists price_rules_updated_at on public.price_rules;
create trigger price_rules_updated_at before update on public.price_rules
for each row execute function public.set_updated_at();

alter table public.app_admins enable row level security;
alter table public.catalog_items enable row level security;
alter table public.price_rules enable row level security;
alter table public.game_price_tiers enable row level security;
alter table public.game_count_discount enable row level security;
alter table public.admin_login_attempts enable row level security;

grant select on public.app_admins to authenticated;
grant select on public.catalog_items, public.price_rules to anon, authenticated;
grant select on public.game_price_tiers to anon, authenticated;
grant select on public.game_count_discount to anon, authenticated;
grant insert, update, delete on public.catalog_items, public.price_rules, public.game_price_tiers, public.game_count_discount to authenticated;

create policy "Admins see own membership" on public.app_admins
for select to authenticated using (user_id = (select auth.uid()));

create policy "Visitors see active catalog" on public.catalog_items
for select to anon, authenticated using (
  active or exists (select 1 from public.app_admins where user_id = (select auth.uid()))
);
create policy "Admins add catalog items" on public.catalog_items
for insert to authenticated with check (
  exists (select 1 from public.app_admins where user_id = (select auth.uid()))
);
create policy "Admins update catalog items" on public.catalog_items
for update to authenticated using (
  exists (select 1 from public.app_admins where user_id = (select auth.uid()))
) with check (
  exists (select 1 from public.app_admins where user_id = (select auth.uid()))
);
create policy "Admins delete catalog items" on public.catalog_items
for delete to authenticated using (
  exists (select 1 from public.app_admins where user_id = (select auth.uid()))
);

create policy "Everyone sees prices" on public.price_rules
for select to anon, authenticated using (true);
create policy "Admins set prices" on public.price_rules
for update to authenticated using (
  exists (select 1 from public.app_admins where user_id = (select auth.uid()))
) with check (
  exists (select 1 from public.app_admins where user_id = (select auth.uid()))
);

create policy "Everyone sees game prices" on public.game_price_tiers
for select to anon, authenticated using (true);
create policy "Admins add game prices" on public.game_price_tiers
for insert to authenticated with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));
create policy "Admins update game prices" on public.game_price_tiers
for update to authenticated using (exists (select 1 from public.app_admins where user_id = (select auth.uid())))
with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));
create policy "Admins delete game prices" on public.game_price_tiers
for delete to authenticated using (exists (select 1 from public.app_admins where user_id = (select auth.uid())));
create policy "Everyone sees game count discount" on public.game_count_discount
for select to anon, authenticated using (true);
create policy "Admins update game count discount" on public.game_count_discount
for update to authenticated using (exists (select 1 from public.app_admins where user_id = (select auth.uid())))
with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));

create table if not exists public.site_settings (
  id boolean primary key default true check (id),
  whatsapp_number text not null default ''
    check (whatsapp_number = '' or whatsapp_number ~ '^[1-9][0-9]{7,14}$')
);

insert into public.site_settings (id, whatsapp_number)
values (true, '')
on conflict (id) do nothing;

alter table public.site_settings enable row level security;

grant select on public.site_settings to anon, authenticated;
grant update on public.site_settings to authenticated;

create policy "Everyone sees public site settings" on public.site_settings
for select to anon, authenticated using (id);

create policy "Admins update site settings" on public.site_settings
for update to authenticated
using (exists (select 1 from public.app_admins where user_id = (select auth.uid())))
with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));

-- Affiches servies depuis Supabase Storage après import admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posters', 'posters', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
