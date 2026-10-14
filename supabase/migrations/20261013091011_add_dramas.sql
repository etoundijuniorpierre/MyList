-- Catégorie Dramas avec distinction pays et grille saisonnière indépendante.
alter table public.catalog_items
  drop constraint if exists catalog_items_category_check;
alter table public.catalog_items
  add constraint catalog_items_category_check
  check (category in ('series', 'games', 'anime', 'novelas', 'dramas'));

alter table public.catalog_items
  drop constraint if exists catalog_items_media_type_check;
alter table public.catalog_items
  drop constraint if exists catalog_media_type_check;
alter table public.catalog_items
  add constraint catalog_media_type_check
  check (
    (category = 'anime' and media_type = 'anime' and media_type is not null) or
    (category = 'dramas' and media_type is not null and media_type in ('chinese-drama', 'korean-drama')) or
    (category not in ('anime', 'dramas') and media_type is null)
  );

alter table public.price_rules
  drop constraint if exists price_rules_category_check;
alter table public.price_rules
  add constraint price_rules_category_check
  check (category in ('series', 'anime', 'novelas', 'dramas'));

insert into public.price_rules (category)
values ('dramas')
on conflict (category) do nothing;
