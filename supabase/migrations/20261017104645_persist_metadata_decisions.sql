-- Décisions humaines conservées avec la fiche, sur tous les appareils.
alter table public.catalog_items
  add column if not exists metadata_preferences jsonb not null default '{}'::jsonb,
  add column if not exists seasons_total integer,
  add column if not exists seasons_checked_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.catalog_items'::regclass and conname = 'catalog_metadata_preferences_object') then
    alter table public.catalog_items add constraint catalog_metadata_preferences_object check (jsonb_typeof(metadata_preferences) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.catalog_items'::regclass and conname = 'catalog_seasons_total_valid') then
    alter table public.catalog_items add constraint catalog_seasons_total_valid check (seasons_total is null or seasons_total between 1 and 999);
  end if;
end $$;
comment on column public.catalog_items.metadata_preferences is
  'Titre accepté, correspondance choisie/refusée et nombre de saisons validé par un administrateur. Les écritures gardent les RLS existantes.';
comment on column public.catalog_items.seasons_total is
  'Total référencé par une source vérifiée ; distinct des saisons disponibles utilisées pour la facturation.';
notify pgrst, 'reload schema';
