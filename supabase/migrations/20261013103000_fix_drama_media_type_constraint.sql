-- The deployed database has used both names for this constraint over time.
alter table public.catalog_items
  drop constraint if exists catalog_items_media_type_check;
alter table public.catalog_items
  drop constraint if exists catalog_media_type_check;
alter table public.catalog_items
  add constraint catalog_media_type_check check (
    (category = 'anime' and media_type = 'anime' and media_type is not null) or
    (category = 'dramas' and media_type is not null and media_type in ('chinese-drama', 'korean-drama')) or
    (category not in ('anime', 'dramas') and media_type is null)
  );
