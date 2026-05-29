-- Ardent MDS — core allotment data schema.
-- Moves the ~120k MCC allotment rows (currently JSON-on-disk in server/cache/,
-- which is gitignored) into Postgres. Auth-independent: this migration only
-- holds the public counseling data + its import provenance.

-- ── Import provenance: one row per ingested MCC allotment file ──────────────
create table if not exists public.mcc_sources (
  id            bigint generated always as identity primary key,
  source        text        not null default 'MCC',
  url           text,
  year          int         not null,
  round         text        not null,          -- R1 | R2 | R3 | Mop-up | Stray
  pages         int,
  bytes         bigint,
  record_count  int         not null default 0,
  skipped_count int         not null default 0,
  cache_key     text        unique,            -- mirrors the on-disk cacheKey; lets re-imports upsert
  imported_at   timestamptz not null default now()
);

-- ── Allotment rows: one row per (candidate, allotted seat) ──────────────────
create table if not exists public.allotment_records (
  id         bigint generated always as identity primary key,
  source_id  bigint  references public.mcc_sources(id) on delete cascade,
  year       int     not null,
  round      text    not null,
  rank       int     not null,
  college    text    not null,                 -- raw MCC string; canonicalized in app layer
  course     text    not null,
  quota      text    not null,
  category   text    not null,
  state      text,                             -- only present on CSV-imported rows
  is_pwbd    boolean not null default false,
  created_at timestamptz not null default now()
);

-- Query patterns: year filter (time-machine), (college,course) grouping for
-- predictAll, (quota,category) pool filtering, and source joins.
create index if not exists idx_allotment_year            on public.allotment_records (year);
create index if not exists idx_allotment_college_course  on public.allotment_records (college, course);
create index if not exists idx_allotment_quota_category  on public.allotment_records (quota, category);
create index if not exists idx_allotment_source          on public.allotment_records (source_id);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Allotment data is public counseling information → public read. Writes happen
-- only through the bulk loader using the service_role key (which bypasses RLS),
-- so no write policies are defined. This is safe for both a server-mediated and
-- a client-direct (anon key) access pattern.
alter table public.mcc_sources       enable row level security;
alter table public.allotment_records enable row level security;

drop policy if exists "public read mcc_sources" on public.mcc_sources;
create policy "public read mcc_sources"
  on public.mcc_sources for select
  using (true);

drop policy if exists "public read allotment_records" on public.allotment_records;
create policy "public read allotment_records"
  on public.allotment_records for select
  using (true);
