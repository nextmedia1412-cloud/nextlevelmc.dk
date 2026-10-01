-- Next Level MC · Events
-- Kør hele filen i Supabase SQL Editor i det nye projekt.

create extension if not exists pgcrypto;

-- Brugere der må oprette, redigere og slette events.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  starts_at timestamptz not null,
  location text not null,
  description text,
  created_at timestamptz default now()
);

create index if not exists events_starts_at_idx on public.events(starts_at);

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admins a
    where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.admins enable row level security;
alter table public.events enable row level security;

-- admins har ingen policies: tabellen kan kun ændres her i SQL Editor.
grant usage on schema public to anon, authenticated;
grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;

-- Alle må se events.
drop policy if exists "events_select_all" on public.events;
create policy "events_select_all"
on public.events
for select
to anon, authenticated
using (true);

-- Kun admins må oprette, redigere og slette events.
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

-- GØR EN BRUGER TIL ADMIN:
-- Opret først brugeren under Authentication → Users → Add user (sæt flueben i Auto Confirm User),
-- ret derefter emailen herunder, fjern "--" foran de to linjer og kør dem.
--
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'din@email.dk';
