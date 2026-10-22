-- À exécuter sur le projet lié. Toutes les écritures sont annulées.
begin;
select set_config('request.jwt.claim.sub', (select user_id::text from public.app_admins where username='ejep'), true);
set local role authenticated;

do $$
declare
  original public.catalog_items;
  saved public.catalog_items;
  normalized text[];
begin
  normalized := public.normalize_catalog_genres(array['Drama', 'Drame', ' Comedy ', 'Tranche de vie', 'Slice of Life', 'Arts martiaux', 'RPG', 'Tag maison', null, '']);
  if normalized is distinct from array['Drame', 'Comédie', 'Tranche de vie', 'Arts martiaux', 'RPG', 'Tag maison'] then
    raise exception 'Traduction, ordre, dédoublonnage ou genre personnalisé incorrect';
  end if;
  if public.normalize_catalog_genres(normalized) is distinct from normalized
     or public.normalize_catalog_genres(null) is distinct from '{}'::text[] then
    raise exception 'Normalisation non idempotente ou liste vide incorrecte';
  end if;

  select * into original from public.catalog_items where active order by id limit 1 for update;
  if not found then raise exception 'Une fiche est nécessaire pour tester le véritable enregistrement'; end if;
  update public.catalog_items
  set genres=array['Adventure', 'Aventure', 'Music'],
      metadata_preferences=metadata_preferences || jsonb_build_object('match',
        coalesce(metadata_preferences->'match', '{}'::jsonb) || jsonb_build_object('genres', array['Fantasy', 'Mystery', 'Fantasy']))
  where id=original.id returning * into saved;
  if saved.genres is distinct from array['Aventure', 'Musique']
     or saved.metadata_preferences->'match'->'genres' is distinct from '["Fantastique","Mystère"]'::jsonb then
    raise exception 'Le déclencheur ne protège pas la fiche et la correspondance mémorisée';
  end if;
  if (to_jsonb(saved) - array['genres','metadata_preferences','updated_at']) is distinct from
     (to_jsonb(original) - array['genres','metadata_preferences','updated_at'])
     or (saved.metadata_preferences - 'match') is distinct from (original.metadata_preferences - 'match') then
    raise exception 'La normalisation a modifié une donnée étrangère aux genres';
  end if;
end;
$$;
select 'Genre translation and authenticated save verified; transaction rolled back' as result;
rollback;
