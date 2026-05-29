/* Bulk-load the on-disk MCC cache (server/cache/*.json) into Supabase.
   Run AFTER applying the migrations:  node scripts/seed-supabase.mjs

   Requires:
     - npm i @supabase/supabase-js
     - env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
       (service_role is needed to bypass RLS for inserts — keep it server-side only)
*/
import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, "server", "cache");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const files = (await readdir(CACHE_DIR)).filter(f => f.startsWith("mcc-") && f.endsWith(".json"));
console.log(`Found ${files.length} cache files.`);

let totalRows = 0;
for (const f of files) {
  const payload = JSON.parse(await readFile(path.join(CACHE_DIR, f), "utf8"));

  // Upsert the source row (idempotent on cache_key) and get its id.
  const { data: src, error: srcErr } = await supabase
    .from("mcc_sources")
    .upsert(
      {
        source: payload.source || "MCC",
        url: payload.url,
        year: payload.year,
        round: payload.round,
        pages: payload.pages ?? null,
        bytes: payload.bytes ?? null,
        record_count: payload.recordCount ?? (payload.records || []).length,
        skipped_count: payload.skippedCount ?? 0,
        cache_key: payload.cacheKey || f,
      },
      { onConflict: "cache_key" }
    )
    .select("id")
    .single();
  if (srcErr) { console.error(`  ${f}: source upsert failed —`, srcErr.message); continue; }

  // Replace this source's rows so re-running is idempotent.
  await supabase.from("allotment_records").delete().eq("source_id", src.id);

  const rows = (payload.records || []).map(r => ({
    source_id: src.id,
    year: r.year,
    round: r.round,
    rank: r.rank,
    college: r.college,
    course: r.course,
    quota: r.quota,
    category: r.category,
    state: r.state ?? null,
    is_pwbd: !!r.isPwBD,            // camelCase (app) → snake_case (db)
  }));

  // Insert in chunks to stay under payload limits.
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from("allotment_records").insert(rows.slice(i, i + CHUNK));
    if (error) { console.error(`  ${f}: insert failed at ${i} —`, error.message); break; }
  }
  totalRows += rows.length;
  console.log(`  ${f}: ${rows.length} rows`);
}

console.log(`Done. Inserted ~${totalRows} allotment rows.`);
