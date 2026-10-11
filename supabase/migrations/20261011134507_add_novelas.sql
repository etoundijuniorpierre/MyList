-- Les novelas sont une quatrième catégorie, avec leur propre grille par saison.
alter table public.catalog_items
  drop constraint if exists catalog_items_category_check;
alter table public.catalog_items
  add constraint catalog_items_category_check
  check (category in ('series', 'games', 'anime', 'novelas'));

alter table public.price_rules
  drop constraint if exists price_rules_category_check;
alter table public.price_rules
  add constraint price_rules_category_check
  check (category in ('series', 'anime', 'novelas'));

-- Une même fiche externe peut être classée en série ou en novela sans collision.
drop index if exists public.catalog_source_unique;
create unique index catalog_source_unique
  on public.catalog_items (category, source, source_id)
  where source_id is not null;

insert into public.price_rules (category)
values ('novelas')
on conflict (category) do nothing;
