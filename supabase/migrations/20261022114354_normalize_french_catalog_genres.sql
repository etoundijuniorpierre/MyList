-- Traduction locale des libellés connus : aucun appel externe, ni choix de genre.
-- Les libellés personnalisés et l'ordre initial sont conservés.
create or replace function public.normalize_catalog_genres(p_genres text[])
returns text[]
language sql immutable parallel safe security invoker
set search_path = ''
as $$
  with labels as (
    select ord, case lower(btrim(label))
      when 'action' then 'Action'
      when 'adventure' then 'Aventure'
      when 'anime' then 'Animé'
      when 'casual' then 'Occasionnel'
      when 'children' then 'Jeunesse'
      when 'comedy' then 'Comédie'
      when 'comique' then 'Comédie'
      when 'crime' then 'Policier'
      when 'drama' then 'Drame'
      when 'espionage' then 'Espionnage'
      when 'family' then 'Famille'
      when 'fantasy' then 'Fantastique'
      when 'fantaisie' then 'Fantastique'
      when 'free to play' then 'Jeu gratuit'
      when 'history' then 'Historique'
      when 'horror' then 'Horreur'
      when 'indie' then 'Indépendant'
      when 'legal' then 'Judiciaire'
      when 'massively multiplayer' then 'Multijoueur massif'
      when 'mecha' then 'Mecha'
      when 'medical' then 'Médical'
      when 'music' then 'Musique'
      when 'mystery' then 'Mystère'
      when 'psychological' then 'Psychologique'
      when 'racing' then 'Course'
      when 'robot' then 'Robot'
      when 'sci-fi' then 'Science-fiction'
      when 'science-fiction' then 'Science-fiction'
      when 'slice of life' then 'Tranche de vie'
      when 'sports' then 'Sport'
      when 'strategy' then 'Stratégie'
      when 'supernatural' then 'Surnaturel'
      when 'telenovela' then 'Télénovela'
      when 'war' then 'Guerre'
      else btrim(label)
    end as label
    from unnest(coalesce(p_genres, '{}'::text[])) with ordinality as input(label, ord)
    where nullif(btrim(label), '') is not null
  )
  select coalesce(array_agg(label order by first_position), '{}'::text[])
  from (select label, min(ord) as first_position from labels group by label) unique_labels;
$$;

create or replace function public.normalize_catalog_genres_on_write()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  new.genres := public.normalize_catalog_genres(new.genres);
  -- Une correspondance mémorisée ne doit pas réintroduire les libellés anglais.
  if jsonb_typeof(new.metadata_preferences->'match'->'genres') = 'array' then
    new.metadata_preferences := jsonb_set(new.metadata_preferences, '{match,genres}',
      to_jsonb(public.normalize_catalog_genres(array(
        select jsonb_array_elements_text(new.metadata_preferences->'match'->'genres')
      ))));
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_catalog_genres(text[]) from public, anon;
revoke all on function public.normalize_catalog_genres_on_write() from public, anon;
grant execute on function public.normalize_catalog_genres(text[]) to authenticated, service_role;
grant execute on function public.normalize_catalog_genres_on_write() to authenticated, service_role;

drop trigger if exists catalog_items_french_genres on public.catalog_items;
create trigger catalog_items_french_genres
before insert or update of genres, metadata_preferences on public.catalog_items
for each row execute function public.normalize_catalog_genres_on_write();
