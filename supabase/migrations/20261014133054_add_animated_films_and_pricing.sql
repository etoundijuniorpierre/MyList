-- Les films d'animation partagent la page Animés, mais leur tarif est autonome.
alter table public.catalog_items
  add column if not exists media_format text;

alter table public.catalog_items
  drop constraint if exists catalog_items_media_format_check;
alter table public.catalog_items
  add constraint catalog_items_media_format_check
  check (media_format is null or media_format in ('series', 'film'));

alter table public.price_rules
  drop constraint if exists price_rules_category_check;
alter table public.price_rules
  add constraint price_rules_category_check
  check (category in ('series', 'anime', 'anime-film', 'novelas', 'dramas'));

insert into public.price_rules (category)
values ('anime-film')
on conflict (category) do nothing;
