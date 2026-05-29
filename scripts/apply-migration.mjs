/* One-off: apply supabase/apply_all.sql directly to the Supabase Postgres.
   Password is read from env (never persisted):
     SUPABASE_DB_PASSWORD='...' node scripts/apply-migration.mjs
   Optional overrides: PGHOST, PGPORT, PGUSER (defaults target the direct conn). */
import pg from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) { console.error("Set SUPABASE_DB_PASSWORD env var."); process.exit(1); }

const sql = await readFile(path.join(ROOT, "supabase", "apply_all.sql"), "utf8");
const REF = "vhiejhwuwfhqzmlwscbx";

// Build the candidate connection list. New Supabase projects route through the
// Supavisor pooler (user = postgres.<ref>); the region is in the host.
const regions = [
  "ap-south-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1",
  "us-east-1", "us-east-2", "us-west-1", "eu-central-1", "eu-west-1",
  "eu-west-2", "ca-central-1", "sa-east-1",
];
const candidates = [{ host: `db.${REF}.supabase.co`, user: "postgres", port: 5432 }];
for (const pre of ["aws-0", "aws-1"]) {
  for (const r of regions) {
    candidates.push({ host: `${pre}-${r}.pooler.supabase.com`, user: `postgres.${REF}`, port: 5432 });
  }
}

let applied = false;
for (const c of candidates) {
  const client = new pg.Client({
    host: c.host, port: c.port, user: c.user, password,
    database: "postgres", ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 7000,
  });
  try {
    await client.connect();
    console.log(`Connected via ${c.host} (user ${c.user}). Applying schema…`);
    await client.query(sql);
    const { rows } = await client.query(
      "select table_name from information_schema.tables where table_schema='public' order by table_name"
    );
    console.log("Public tables now:", rows.map(r => r.table_name).join(", "));
    console.log("Migration applied successfully.");
    applied = true;
    await client.end().catch(() => {});
    break;
  } catch (e) {
    await client.end().catch(() => {});
    const msg = (e.code || "") + " " + (e.message || "");
    // Skip hosts that don't resolve / wrong tenant; surface real auth errors.
    if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|Tenant or user not found/i.test(msg)) {
      continue;
    }
    console.error(`Error on ${c.host}: ${msg}`);
    if (/password|authentication/i.test(msg)) { console.error("→ Looks like a wrong DB password."); break; }
  }
}
if (!applied) {
  console.error("Could not connect to the database on any candidate host. Send the exact connection string from Dashboard → Settings → Database.");
  process.exitCode = 1;
}
