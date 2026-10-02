-- Next Level MC · Events, brugere, tilmeldinger og notifikationer
-- Kør hele filen i Supabase SQL Editor. Den kan køres igen uden at ødelægge noget.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- BRUGERE
-- Oprettes og slettes via edge function "admin-users" (admin-panelet på /member).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz default now()
);

-- Flytter admins fra den gamle admins-tabel over i profiles.
do $$
begin
  if to_regclass('public.admins') is not null then
    insert into public.profiles (id, username, display_name, role)
    select u.id, split_part(u.email, '@', 1), split_part(u.email, '@', 1), 'admin'
    from public.admins a
    join auth.users u on u.id = a.user_id
    on conflict (id) do nothing;
  end if;
end $$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

drop table if exists public.admins;

-- EVENTS
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  starts_at timestamptz not null,
  location text not null,
  description text,
  created_at timestamptz default now()
);

-- Sættes af edge function "push", så hver påmindelse kun sendes én gang.
alter table public.events add column if not exists reminder_day_before_sent_at timestamptz;
alter table public.events add column if not exists reminder_rsvp_sent_at timestamptz;

create index if not exists events_starts_at_idx on public.events(starts_at);

-- SVAR PÅ EVENTS (kommer / kommer ikke)
create table if not exists public.event_responses (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('yes', 'no')),
  updated_at timestamptz default now(),
  primary key (event_id, user_id)
);

-- PUSH-TILMELDINGER (én række pr. telefon/browser)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_responses enable row level security;
alter table public.push_subscriptions enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.event_responses to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- PROFILES: medlemmer må se hinandens navne. Ændringer sker kun via edge function.
drop policy if exists "profiles_select_members" on public.profiles;
create policy "profiles_select_members"
on public.profiles
for select
to authenticated
using (true);

-- EVENTS: alle må se, kun admins må ændre.
drop policy if exists "events_select_all" on public.events;
create policy "events_select_all"
on public.events
for select
to anon, authenticated
using (true);

drop policy if exists "events_insert_admin" on public.events;
create policy "events_insert_admin"
on public.events
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "events_update_admin" on public.events;
create policy "events_update_admin"
on public.events
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "events_delete_admin" on public.events;
create policy "events_delete_admin"
on public.events
for delete
to authenticated
using (public.is_admin());

-- SVAR: medlemmer må se alles svar, men kun ændre deres eget.
drop policy if exists "responses_select_members" on public.event_responses;
create policy "responses_select_members"
on public.event_responses
for select
to authenticated
using (true);

drop policy if exists "responses_insert_own" on public.event_responses;
create policy "responses_insert_own"
on public.event_responses
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "responses_update_own" on public.event_responses;
create policy "responses_update_own"
on public.event_responses
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "responses_delete_own" on public.event_responses;
create policy "responses_delete_own"
on public.event_responses
for delete
to authenticated
using (user_id = auth.uid());

-- PUSH-TILMELDINGER: kun ens egne.
drop policy if exists "push_select_own" on public.push_subscriptions;
create policy "push_select_own"
on public.push_subscriptions
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "push_insert_own" on public.push_subscriptions;
create policy "push_insert_own"
on public.push_subscriptions
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "push_update_own" on public.push_subscriptions;
create policy "push_update_own"
on public.push_subscriptions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "push_delete_own" on public.push_subscriptions;
create policy "push_delete_own"
on public.push_subscriptions
for delete
to authenticated
using (user_id = auth.uid());

-- PÅMINDELSER: kalder edge function "push" hver time. Funktionen finder selv ud af,
-- om der er noget at sende, og sender hver påmindelse højst én gang.
select cron.schedule(
  'event-reminders',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://fsovpbiozmhdxtffrfuu.supabase.co/functions/v1/push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"action": "cron"}'::jsonb
  );
  $$
);

-- FØRSTE ADMIN I ET HELT NYT PROJEKT:
-- Opret brugeren under Authentication → Users → Add user (flueben i Auto Confirm User),
-- ret emailen herunder, fjern "--" foran linjerne og kør dem.
--
-- insert into public.profiles (id, username, display_name, role)
-- select id, split_part(email, '@', 1), split_part(email, '@', 1), 'admin'
-- from auth.users where email = 'din@email.dk';
