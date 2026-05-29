/* Seed the colleges master table from the bundled list.
   Run after migrations:  node scripts/seed-colleges.mjs
   Requires: @supabase/supabase-js + env SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY */
import { createClient } from "@supabase/supabase-js";
import { COLLEGES } from "../src/lib/colleges.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const supabase = createClient(url, key, { auth: { persistSession: false } });

const rows = COLLEGES.map(c => ({
  id: c.id,
  name: c.name,
  aliases: c.aliases || [],
  state: c.state ?? null,
  city: c.city ?? null,
  type: c.type ?? null,
  established: c.established ?? null,
  total_pg_seats: c.totalPgSeats ?? null,
  is_minority_institution: !!c.isMinorityInstitution,
  minority_type: c.minorityType ?? null,
  pg_courses_offered: c.pgCoursesOffered || [],
  affiliation: c.affiliation ?? null,
}));

const { error } = await supabase.from("colleges").upsert(rows, { onConflict: "id" });
if (error) { console.error("Seed failed:", error.message); process.exit(1); }
console.log(`Seeded ${rows.length} colleges.`);
