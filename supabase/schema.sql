-- Next Level MC · Opgavesystem V1
-- Kør hele filen i Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  role text not null default 'member' check (role in ('member', 'admin')),
  active boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  weight int not null default 1 check (weight between 1 and 3),
  active boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists public.assignment_rounds (
  id uuid primary key default gen_random_uuid(),
  month text not null unique check (month ~ '^\d{4}-\d{2}$'),
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.assignment_rounds(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  task_id uuid not null references public.tasks(id),
  user_id uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending', 'done')),
  created_at timestamptz default now(),
  completed_at timestamptz,
  unique (round_id, task_id)
);

create index if not exists profiles_username_idx on public.profiles(username);
create index if not exists profiles_active_idx on public.profiles(active);
create index if not exists tasks_active_idx on public.tasks(active);
create index if not exists assignments_month_idx on public.assignments(month);
create index if not exists assignments_user_month_idx on public.assignments(user_id, month);
create index if not exists assignments_task_user_month_idx on public.assignments(task_id, user_id, month);

-- Helper: undgår recursive RLS på profiles, når policies skal tjekke admin-rolle.
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
      and p.active = true
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Ekstra vagt: almindelige medlemmer må kun ændre egen assignment til status 'done'.
create or replace function public.guard_member_assignment_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' and not public.is_admin() then
    if old.user_id is distinct from auth.uid() then
      raise exception 'Du må kun opdatere dine egne opgaver.';
    end if;

    if new.id is distinct from old.id
      or new.round_id is distinct from old.round_id
      or new.month is distinct from old.month
      or new.task_id is distinct from old.task_id
      or new.user_id is distinct from old.user_id
      or new.created_at is distinct from old.created_at then
      raise exception 'Du må kun ændre status på din egen opgave.';
    end if;

    if new.status is distinct from 'done' then
      raise exception 'Medlemmer kan kun markere en opgave som udført.';
    end if;

    new.completed_at = coalesce(new.completed_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists assignments_member_update_guard on public.assignments;
create trigger assignments_member_update_guard
before update on public.assignments
for each row
execute function public.guard_member_assignment_update();

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.assignment_rounds enable row level security;
alter table public.assignments enable row level security;

-- Grants til PostgREST/Supabase API. RLS bestemmer stadig, hvilke rows der må læses/ændres.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.assignment_rounds to authenticated;
grant select, insert, update, delete on public.assignments to authenticated;

-- PROFILES

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- TASKS

drop policy if exists "tasks_select_active_or_admin" on public.tasks;
create policy "tasks_select_active_or_admin"
on public.tasks
for select
to authenticated
using (active = true or public.is_admin());

drop policy if exists "tasks_insert_admin" on public.tasks;
create policy "tasks_insert_admin"
on public.tasks
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "tasks_update_admin" on public.tasks;
create policy "tasks_update_admin"
on public.tasks
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "tasks_delete_admin" on public.tasks;
create policy "tasks_delete_admin"
on public.tasks
for delete
to authenticated
using (public.is_admin());

-- ASSIGNMENT ROUNDS

drop policy if exists "rounds_select_admin_or_own" on public.assignment_rounds;
create policy "rounds_select_admin_or_own"
on public.assignment_rounds
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.assignments a
    where a.round_id = assignment_rounds.id
      and a.user_id = auth.uid()
  )
);

drop policy if exists "rounds_insert_admin" on public.assignment_rounds;
create policy "rounds_insert_admin"
on public.assignment_rounds
for insert
to authenticated
with check (public.is_admin());

-- ASSIGNMENTS

drop policy if exists "assignments_select_own_or_admin" on public.assignments;
create policy "assignments_select_own_or_admin"
on public.assignments
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "assignments_insert_admin" on public.assignments;
create policy "assignments_insert_admin"
on public.assignments
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "assignments_update_admin" on public.assignments;
create policy "assignments_update_admin"
on public.assignments
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "assignments_member_mark_done" on public.assignments;
create policy "assignments_member_mark_done"
on public.assignments
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and status = 'done');
