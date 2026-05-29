-- Ardent MDS — colleges master list mirrored into the DB.
-- The 120-college NMC PG list currently lives in src/lib/colleges.js. Mirroring
-- it here lets metadata be edited without a redeploy. NOTE: the fuzzy matcher
-- (collegeMatch.js) still builds its index from the bundled list at build time,
-- so keep the two in sync until/unless the matcher is moved server-side.

create table if not exists public.colleges (
  id                      text primary key,        -- e.g. 'AIIMS-001'
  name                    text not null,
  aliases                 text[] not null default '{}',
  state                   text,
  city                    text,
  type                    text,                     -- Central-INI | Government | Deemed | ...
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
