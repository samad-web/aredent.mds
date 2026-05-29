/* Browser Supabase client (client-direct access pattern).
   Reads anon key from Vite env (VITE_*). Returns null when unconfigured so the
   app can fall back to localStorage / the /api layer during migration. */
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anon ? createClient(url, anon) : null;
export const isSupabaseConfigured = Boolean(supabase);

/* Approach A — paginate the full allotment table to the browser and compute
   predictions client-side (as the app does today). PostgREST caps each response
   at the project's max-rows (default 1000), so we fetch pages with bounded
   concurrency and map snake_case → the app's camelCase record shape. */
const COLS = "year,round,rank,college,course,quota,category,state,is_pwbd";
const mapRow = (r) => ({
  year: r.year, round: r.round, rank: r.rank,
  college: r.college, course: r.course,
  quota: r.quota, category: r.category,
  state: r.state ?? undefined, isPwBD: r.is_pwbd,
});

export async function fetchAllotmentRecords({ pageSize = 1000, concurrency = 8 } = {}) {
  if (!supabase) throw new Error("Supabase not configured");

  // First page doubles as the exact-count probe. We deliberately AVOID a
  // head:true count request — that issues an HTTP HEAD which some browsers
  // abort (net::ERR_ABORTED), leaving the app stuck loading. A GET with
  // count:"exact" returns both the rows and the total.
  const first = await supabase
    .from("allotment_records")
    .select(COLS, { count: "exact" })
    .order("id", { ascending: true })
    .range(0, pageSize - 1);
  if (first.error) throw first.error;

  const total = first.count ?? first.data.length;
  const out = new Array(total);
  first.data.forEach((r, i) => { out[i] = mapRow(r); });

  const pages = Math.ceil(total / pageSize);
  let nextPage = 1; // page 0 already fetched above

  async function worker() {
    for (let p = nextPage++; p < pages; p = nextPage++) {
      const from = p * pageSize;
      const to = Math.min(from + pageSize - 1, total - 1);
      const { data, error } = await supabase
        .from("allotment_records")
        .select(COLS)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      for (let i = 0; i < data.length; i++) out[from + i] = mapRow(data[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(0, pages - 1)) }, worker)
  );
  return out;
}
