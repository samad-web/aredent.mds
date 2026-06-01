/* Server-side Supabase sync (service_role — bypasses RLS). Used by the MCC
   import endpoint so freshly-parsed allotment data lands in the DB the client
   reads from. No-ops cleanly if env isn't configured. */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const serverSupabase = url && key
  ? createClient(url, key, { auth: { persistSession: false } })
  : null;
export const isServerSupabaseConfigured = Boolean(serverSupabase);

/* Upsert one scrape payload (source row + its allotment rows). Idempotent:
   the source upserts on cache_key and its rows are replaced. */
export async function syncPayloadToSupabase(payload) {
  if (!serverSupabase) return { synced: false, reason: "supabase not configured" };

  const { data: src, error: srcErr } = await serverSupabase
    .from("mcc_sources")
    .upsert({
      source: payload.source || "MCC",
      stream: payload.stream || "PG",
      url: payload.url,
      year: payload.year,
      round: payload.round,
      pages: payload.pages ?? null,
      bytes: payload.bytes ?? null,
      record_count: payload.recordCount ?? (payload.records || []).length,
      skipped_count: payload.skippedCount ?? 0,
      cache_key: payload.cacheKey,
    }, { onConflict: "cache_key" })
    .select("id")
    .single();
  if (srcErr) throw new Error(`mcc_sources upsert: ${srcErr.message}`);

  // Replace this source's rows so re-imports don't duplicate.
  await serverSupabase.from("allotment_records").delete().eq("source_id", src.id);

  const streamDefault = payload.stream || "PG";
  const rows = (payload.records || []).map(r => ({
    source_id: src.id,
    stream: r.stream || streamDefault,
    year: r.year, round: r.round, rank: r.rank,
    college: r.college, course: r.course,
    quota: r.quota, category: r.category ?? null,
    state: r.state ?? null,
    is_pwbd: !!r.isPwBD,
  }));

  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await serverSupabase.from("allotment_records").insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`allotment_records insert at ${i}: ${error.message}`);
  }
  return { synced: true, sourceId: src.id, rows: rows.length };
}
