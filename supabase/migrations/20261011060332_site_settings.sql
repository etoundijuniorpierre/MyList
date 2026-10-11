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
