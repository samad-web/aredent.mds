-- ============================================================================
-- Ardent MDS — ALL migrations combined. Paste this whole file into the Supabase
-- Dashboard → SQL Editor → Run. Safe to re-run (idempotent guards throughout).
-- ============================================================================

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 1. Core allotment data (mcc_sources, allotment_records)                    │
-- └──────────────────────────────────────────────────────────────────────────┘
create table if not exists public.mcc_sources (
  id            bigint generated always as identity primary key,
  source        text        not null default 'MCC',
  stream        text        not null default 'PG',  -- 'PG' (NEET-PG) | 'MDS'
  url           text,
  year          int         not null,
  round         text        not null,
  pages         int,
  bytes         bigint,
  record_count  int         not null default 0,
  skipped_count int         not null default 0,
  cache_key     text        unique,
  imported_at   timestamptz not null default now()
);

create table if not exists public.allotment_records (
  id         bigint generated always as identity primary key,
  source_id  bigint  references public.mcc_sources(id) on delete cascade,
  stream     text    not null default 'PG',  -- 'PG' (NEET-PG) | 'MDS'
  year       int     not null,
  round      text    not null,
  rank       int     not null,
  college    text    not null,
  course     text    not null,
  quota      text    not null,
  category   text,    -- nullable: MDS admitted-lists carry no category
  state      text,
  is_pwbd    boolean not null default false,
  created_at timestamptz not null default now()
);

-- Idempotent upgrades for databases created before the MDS work.
alter table public.mcc_sources       add column if not exists stream text not null default 'PG';
alter table public.allotment_records add column if not exists stream text not null default 'PG';
alter table public.allotment_records alter column category drop not null;

create index if not exists idx_allotment_year            on public.allotment_records (year);
create index if not exists idx_allotment_stream          on public.allotment_records (stream);
create index if not exists idx_allotment_college_course  on public.allotment_records (college, course);
create index if not exists idx_allotment_quota_category  on public.allotment_records (quota, category);
create index if not exists idx_allotment_source          on public.allotment_records (source_id);

alter table public.mcc_sources       enable row level security;
alter table public.allotment_records enable row level security;

drop policy if exists "public read mcc_sources" on public.mcc_sources;
create policy "public read mcc_sources" on public.mcc_sources for select using (true);
drop policy if exists "public read allotment_records" on public.allotment_records;
create policy "public read allotment_records" on public.allotment_records for select using (true);

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 2. Per-user profiles & pinned colleges (full user accounts)                │
-- └──────────────────────────────────────────────────────────────────────────┘
create table if not exists public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  full_name            text,
  reg_number           text,
  mobile               text,
  age                  int,
  gender               text,
  attempt_no           int,
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

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create table if not exists public.interests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  college_id text not null,
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

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 3. Colleges master list mirror                                             │
-- └──────────────────────────────────────────────────────────────────────────┘
create table if not exists public.colleges (
  id                      text primary key,
  name                    text not null,
  aliases                 text[] not null default '{}',
  state                   text,
  city                    text,
  type                    text,
  established             int,
  total_pg_seats          int,
  is_minority_institution boolean not null default false,
  minority_type           text,
  pg_courses_offered      text[] not null default '{}',
  affiliation             text
);

alter table public.colleges enable row level security;
drop policy if exists "public read colleges" on public.colleges;
create policy "public read colleges" on public.colleges for select using (true);
