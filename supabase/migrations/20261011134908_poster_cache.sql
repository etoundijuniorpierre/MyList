-- Lecture publique des affiches ; aucune politique d'écriture côté navigateur.
-- Seule l'Edge Function admin écrit avec la clé serveur.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posters', 'posters', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
