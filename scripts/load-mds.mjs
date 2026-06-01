/* Parse the local NEET-MDS allotment PDFs and sync them to Supabase
   (stream='MDS'). Idempotent — re-running replaces each source's rows.

   Usage:
     node --env-file=.env scripts/load-mds.mjs
   Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
*/
import { PDFParse } from "pdf-parse";
import fs from "node:fs";
import { parseMdsText } from "../server/scrapers/mds.js";
import { syncPayloadToSupabase, isServerSupabaseConfigured } from "../server/lib/supabaseSync.js";
import { normalizeRound } from "../src/lib/normalize.js";

const DL = "C:/Users/mas20/Downloads/";
const FILES = [
  { name: "neet 2022 counselling.pdf", year: 2022, round: "R2" },
  { name: "neet 2023.pdf", year: 2023, round: "R3" },
  { name: "2024 seat allotment.pdf", year: 2024, round: "R3" },
  { name: "neet mds 2025 counselling seat matrix.pdf", year: 2025, round: "Admitted" },
];

if (!isServerSupabaseConfigured) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env scripts/load-mds.mjs");
  process.exit(1);
}

async function extract(buf) {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const r = await parser.getText();
  await parser.destroy().catch(() => {});
  return { text: r.text, pages: r.total };
}

let grand = 0;
for (const f of FILES) {
  const buf = fs.readFileSync(DL + f.name);
  const { text, pages } = await extract(buf);
  const { records, skipped } = parseMdsText(text, { year: f.year, round: f.round });

  const payload = {
    source: "MCC",
    stream: "MDS",
    url: `local:${f.name}`,
    year: f.year,
    round: normalizeRound(f.round),
    pages,
    bytes: buf.length,
    records,
    skippedCount: skipped.length,
    recordCount: records.length,
    cacheKey: `mds-${f.year}-${normalizeRound(f.round)}`,
  };

  const res = await syncPayloadToSupabase(payload);
  grand += records.length;
  console.log(`${f.name}: parsed ${records.length} (skipped ${skipped.length}) → synced`, res);
}
console.log(`\nDone. ${grand} MDS rows synced to Supabase.`);
