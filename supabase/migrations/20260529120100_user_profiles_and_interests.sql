-- Ardent MDS — per-user profiles & pinned colleges (full user accounts).
-- Moves the student profile and "interested" set out of localStorage into the
-- DB so they sync across devices. Client-direct access → strict per-user RLS
-- (a row is only ever visible/writable by its owner).

-- ── Candidate profile: 1:1 with auth.users ─────────────────────────────────
create table if not exists public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  full_name            text,
  reg_number           text,
  mobile               text,
  age                  int,
  gender               text,
  attempt_no           int,
  -- modeled inputs
  neet_pg_rank         int,
  category             text    not null default 'UR',
  domicile_state       text,
  religion             text,
  is_pwbd              boolean not null default false,
  is_in_service        boolean not null default false,
  is_esic_beneficiary  boolean not null default false,
  is_afms_candidate    boolean not null default false,
  preferred_specialties text[] not null default '{}',
  preferred_states      text[] not null default '{}',
  updated_at           timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "own profile select" on public.profiles;
drop policy if exists "own profile insert" on public.profiles;
drop policy if exists "own profile update" on public.profiles;
drop policy if exists "own profile delete" on public.profiles;
create policy "own profile select" on public.profiles for select using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "own profile delete" on public.profiles for delete using (auth.uid() = id);

-- Auto-create a blank profile row on signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Touch updated_at on profile writes.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── Pinned ("interested") colleges ─────────────────────────────────────────
create table if not exists public.interests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  college_id text not null,                 -- references colleges.id (master-list id, e.g. 'AIIMS-001')
  created_at timestamptz not null default now(),
  unique (user_id, college_id)
);

alter table public.interests enable row level security;
drop policy if exists "own interests select" on public.interests;
drop policy if exists "own interests insert" on public.interests;
drop policy if exists "own interests delete" on public.interests;
create policy "own interests select" on public.interests for select using (auth.uid() = user_id);
create policy "own interests insert" on public.interests for insert with check (auth.uid() = user_id);
create policy "own interests delete" on public.interests for delete using (auth.uid() = user_id);
create index if not exists idx_interests_user on public.interests (user_id);
