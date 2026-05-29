/* Rebuild the on-disk MCC cache with the corrected parser.

   - For (year,round) pairs whose source PDF text is still on disk, RE-PARSE
     from scratch with the fixed parser (maximal clean recovery).
   - For every other cache file, drop rows whose institute string is corrupt
     (row-bleed) using the same guard the parser now applies. These can't be
     re-parsed (their source PDFs are gone), so dropping garbage is the best
     we can do.

   Overwrites server/cache/*.json in place, preserving each file's metadata
   (url, cacheKey) so `node scripts/seed-supabase.mjs` stays idempotent.

   Usage: node scripts/rebuild-clean-data.mjs [--write]
   Without --write it's a dry run (reports the before/after, changes nothing).
*/
import { readdir, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePdfText, isBledCollege } from "../server/scrapers/mcc.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, "server", "cache");
const WRITE = process.argv.includes("--write");

// Raw text dumps we still have → which (year, round) cache file they regenerate.
const REPARSE = [
  { txt: "mcc-r1-2024.txt", year: 2024, round: "R1" },
  { txt: "mcc-r2-2023.txt", year: 2023, round: "R2" },
  { txt: "mcc-2024r3.txt",  year: 2024, round: "R3" },
  { txt: "mcc-r3.txt",      year: 2025, round: "R3" },
];
const reparseKey = (y, r) => `${y}::${r}`;
const reparseMap = new Map(REPARSE.map(t => [reparseKey(t.year, t.round), t]));

const files = (await readdir(CACHE_DIR)).filter(f => f.startsWith("mcc-") && f.endsWith(".json"));
const rows = [];
let grandBefore = 0, grandAfter = 0;

for (const f of files) {
  const p = path.join(CACHE_DIR, f);
  const payload = JSON.parse(await readFile(p, "utf8"));
  const before = (payload.records || []).length;
  grandBefore += before;

  const target = reparseMap.get(reparseKey(payload.year, payload.round));
  let cleaned, mode;

  if (target && fs.existsSync(path.join(ROOT, target.txt))) {
    const text = await readFile(path.join(ROOT, target.txt), "utf8");
    const { records } = parsePdfText(text, { year: payload.year, round: payload.round });
    cleaned = records.filter(r => !isBledCollege(r.college));
    mode = "REPARSE";
  } else {
    cleaned = (payload.records || []).filter(r => !isBledCollege(r.college));
    mode = "filter";
  }

  grandAfter += cleaned.length;
  rows.push({ file: f, year: payload.year, round: payload.round, mode, before, after: cleaned.length });

  if (WRITE) {
    payload.records = cleaned;
    payload.recordCount = cleaned.length;
    payload.cleanedAt = "2026-05-29";
    payload.cleanedMode = mode;
    await writeFile(p, JSON.stringify(payload), "utf8");
  }
}

rows.sort((a, b) => (a.year - b.year) || a.round.localeCompare(b.round));
console.log(`${WRITE ? "WROTE" : "DRY RUN"} — ${files.length} cache files\n`);
console.log("year  round    mode      before     after     dropped");
for (const r of rows) {
  const dropped = r.before - r.after;
  const pct = r.before ? ((100 * dropped) / r.before).toFixed(0) : "0";
  console.log(
    String(r.year).padEnd(6) + r.round.padEnd(9) + r.mode.padEnd(10) +
    String(r.before).padStart(8) + String(r.after).padStart(10) +
    `   ${dropped} (${pct}%)`
  );
}
console.log(`\nTOTAL  before=${grandBefore}  after=${grandAfter}  dropped=${grandBefore - grandAfter} (${((100 * (grandBefore - grandAfter)) / grandBefore).toFixed(1)}%)`);
if (!WRITE) console.log("\nRe-run with --write to apply.");
