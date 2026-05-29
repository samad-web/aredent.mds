/* MCC AIQ allotment PDF scraper.

   The Medical Counselling Committee publishes round-by-round allotment
   results as PDFs at https://mcc.nic.in/PGCounselling/. URLs are session-bound
   and change every counseling cycle, so this module takes a PDF URL as input
   rather than trying to discover it.

   Pipeline:
     1. Download PDF (with caching by URL hash)
     2. Extract text via pdf-parse / pdfjs
     3. Heuristically detect tabular allotment rows
     4. Normalize to the predictor's schema
     5. Return + cache parsed JSON

   Known caveats:
   - MCC PDF layouts vary year-to-year. The row regex is permissive; rows that
     don't match are returned in `skipped` for inspection rather than silently
     dropped.
   - College names in MCC PDFs are abbreviated/codified. We pass them through
     as-is; the existing College Browser falls back gracefully when names don't
     match the bundled master list.
*/

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import {
  normalizeRound,
} from "../../src/lib/normalize.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, "..", "cache");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 60_000;
const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50MB ceiling

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function cacheKey(url, year, round) {
  const h = crypto.createHash("sha1").update(`${url}|${year}|${round}`).digest("hex").slice(0, 16);
  return `mcc-${year}-${round}-${h}.json`;
}

async function readCache(key) {
  try {
    const p = path.join(CACHE_DIR, key);
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch { return null; }
}

async function writeCache(key, value) {
  await ensureCacheDir();
  const p = path.join(CACHE_DIR, key);
  await fs.writeFile(p, JSON.stringify(value), "utf8");
}

function extractTextInWorker(buf) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, "mcc-worker.js");
    const child = fork(workerPath, [], {
      // Bump max-old-space — large MCC PDFs use ~500MB during parse.
      execArgv: ["--max-old-space-size=2048"],
      // Advanced serialization (V8) — handles Buffer/Uint8Array natively
      // without JSON-encoding a 9MB array.
      serialization: "advanced",
      silent: false,
    });
    let settled = false;
    const settleOnce = (fn) => (...args) => { if (!settled) { settled = true; fn(...args); } };
    const _resolve = settleOnce(resolve);
    const _reject = settleOnce(reject);

    child.on("message", (msg) => {
      if (msg.ok) _resolve({ text: msg.text, total: msg.pages });
      else _reject(new Error(msg.error || "Parse failed"));
    });
    child.on("error", (err) => _reject(err));
    child.on("exit", (code) => {
      if (code !== 0) _reject(new Error(`Parse worker exited with code ${code}`));
    });

    // V8 serializer transports the Buffer directly — no JSON encoding cost.
    child.send({ data: buf });
  });
}

async function downloadPdf(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "application/pdf,*/*" },
      signal: ctl.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const ctype = res.headers.get("content-type") || "";
  if (!/pdf/i.test(ctype) && !url.toLowerCase().endsWith(".pdf")) {
    // Some servers return application/octet-stream; only hard-fail on obvious HTML.
    if (/html/i.test(ctype)) throw new Error(`Expected PDF, got ${ctype} — URL may need authentication.`);
  }
  const len = parseInt(res.headers.get("content-length") || "0", 10);
  if (len > MAX_PDF_BYTES) throw new Error(`PDF too large: ${len} bytes (max ${MAX_PDF_BYTES}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PDF_BYTES) throw new Error(`PDF too large after download: ${buf.length} bytes.`);
  return buf;
}

// Real MCC PDF parser (validated against 2025 Round 3 trajectory PDF, 90.7% yield).
//
// Structure of MCC allotment PDFs:
//   - Pages 1-3: legend table (quota codes, category codes, course codes)
//   - Pages 4+: trajectory rows, one per candidate
//     "<rank> <R1-quota-code> <R1-college> <R1-course-code> <R1-status>
//      [<R2-...>] [<R3-quota> <R3-college> <R3-course> <R3-seatType> <R3-cat> <seat#> <action>]"
//
// pdf-parse flattens column layout to text with inserted newlines wherever the
// PDF emitted a line break inside a cell. We collapse whitespace then rejoin
// hyphen-wrapped words ("Self- Financed" → "Self-Financed") before parsing.
//
// Per-candidate chunks anchor on "<rank> <2-char R1 quota code>". Within each
// chunk we look for the LAST "<full-quota-label> <college> <course> <seatType>
// <category> <seat#> <action>" tail — that's the candidate's final allotment
// in this round.

const FULL_QUOTAS = [
  "All India", "DNB Quota", "Deemed University",
  "Aligarh Muslim University", "Banaras Hindu University",
  "Delhi University", "IP University",
  "Jain Minority", "Muslim Minority",
  "NRI", "Self-Financed Merit Seat", "Armed Forces Medical",
];
// 2-char codes that some PDFs use instead of full labels (e.g. 2024 R3).
// Word-boundary'd so they don't false-match inside words like "AM" inside
// "AMRITSAR". The 2-char codes are mapped to canonical labels in canonicalQuotaLabel.
const CODE_QUOTAS = ["AI", "AM", "AF", "BH", "DU", "AD", "IP", "JM", "MM", "NR", "PS"];
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FULL_QUOTAS_RE =
  FULL_QUOTAS.map(reEsc).join("|") + "|" +
  // 2-char codes as their own alternatives (already letter-only).
  CODE_QUOTAS.join("|");

const CAT_TOKEN = "Open|Reserve|General|OBC|SC|ST|EWS|BC|EW|GN";
const CAT_LOOKAHEAD = `(?=\\s+(?:${CAT_TOKEN}))`;

const PAREN_BLOCK = "\\([^)]{2,200}\\)";
const CONNECTOR = "(?:\\s*[/.,]\\s*(?:MS|MD|M\\.S\\.|M\\.D\\.)?\\s*)";
const COURSE_RE =
  "(?:" +
    // M.D. (X)[/MS (Y)]* — paren style with optional repeats
    "(?:M\\.D\\.|M\\.S\\.|M\\.Ch\\.|MD\\/MS)\\s*" + PAREN_BLOCK + "(?:" + CONNECTOR + PAREN_BLOCK + ")*" +
    // M.D. IN NAME
    "|(?:M\\.D\\.|M\\.S\\.)\\s+IN\\s+[A-Z][A-Z &.,/'-]{2,120}?" + CAT_LOOKAHEAD +
    // M.D. NAME (no IN, no parens)
    "|(?:M\\.D\\.|M\\.S\\.)\\s+[A-Z][A-Za-z &.,/'-]{2,120}?" + CAT_LOOKAHEAD +
    // (NBEMS) NAME / (NBEMS-DIPLOMA) NAME
    "|\\(NBEMS(?:-DIPLOMA)?\\)\\s+[A-Z][A-Z &.,/()'-]{2,200}?" + CAT_LOOKAHEAD +
  ")";

// Action keyword at the end of an allotment row. Three flavors observed:
//   "Fresh Allotted in 3nd Round" — R3 trajectory PDFs
//   "Upgraded"                    — R2/R3 trajectory upgrades
//   "Allotted"                    — R1 flat-list PDFs (plain remark)
const ACTION_RE = "(?:Fresh Allotted\\s+in\\s+\\w+\\s+Round|Upgraded|Allotted)";

// Trajectory PDFs put three round-columns on one line:
//   <rank> <R1quota> <R1institute> <R1code> <R1status> | <R2…|-> | <R3quota> <R3institute> <R3course> …
// The R1/R2 courses are bare codes (e.g. "GMED") that COURSE_RE doesn't match,
// so a naive `.+?` college capture, anchored on the R1 quota, would run straight
// through the round-separators and status words to the R3 course — bleeding 2-3
// rows into one "college". These tokens NEVER occur inside a real institute name,
// so we temper the college capture to refuse them, which forces the match to
// anchor on the correct (final) quota→institute→course triple.
const BLEED_RE = "(?:- -|Reported|Seat Surrendered|Did not|Upgraded|Fresh Allotted|Not Allotted)";
const COLLEGE_RE = `((?:(?!${BLEED_RE}).)+?)`;

const TAIL_RE = new RegExp(
  // Some PDFs spell the quota as "<label> Quota" (e.g. "All India Quota");
  // absorb the optional trailing "Quota" word so it doesn't leak into the name.
  `(${FULL_QUOTAS_RE})(?:\\s+Quota)?\\s+${COLLEGE_RE}\\s+(${COURSE_RE})\\s+` +
  `(${CAT_TOKEN})\\s+(${CAT_TOKEN})(\\s+PwD)?\\s+` +
  `(?:\\d+\\s+)?${ACTION_RE}`,
  "g"
);

// Defensive guard: a captured institute string that still contains row-bleed
// markers or is implausibly long is corrupt — reject it rather than emit garbage.
const COLLEGE_BLEED_GUARD = /- -|\b(Reported|Seat Surrendered|Did not|Upgraded|Fresh Allotted|Not Allotted|All India|DNB Quota)\b/;
export function isBledCollege(name) {
  const c = (name || "").trim();
  return c.length === 0 || c.length > 90 || COLLEGE_BLEED_GUARD.test(c);
}

// 2-char R1 quota codes — used to detect candidate-row starts.
const R1_QUOTA = "(?:AI|AM|AF|BH|DU|AD|IP|JM|MM|NR|PS)";
const CHUNK_RE = new RegExp(`\\b(\\d{1,7})\\s+${R1_QUOTA}\\s+`, "g");

const CODE_TO_LABEL = {
  AI: "AIQ",
  AM: "Aligarh Muslim University",
  AF: "AFMS",
  BH: "Banaras Hindu University",
  DU: "Delhi University",
  AD: "DNB",
  IP: "IP University",
  JM: "Jain Minority",
  MM: "Muslim Minority",
  NR: "NRI",
  PS: "Management",
};

function canonicalQuotaLabel(q) {
  if (q.length === 2 && CODE_TO_LABEL[q]) return CODE_TO_LABEL[q];
  switch (q) {
    case "All India": return "AIQ";
    case "DNB Quota": return "DNB";
    case "Deemed University": return "Deemed";
    case "Armed Forces Medical": return "AFMS";
    case "Self-Financed Merit Seat": return "Management";
    default: return q;
  }
}

function canonicalCandidateCategory(candCat) {
  const c = candCat.toUpperCase();
  if (c === "GENERAL" || c === "GN") return "UR";
  if (c === "OBC" || c === "BC") return "OBC-NCL";
  if (c === "EWS" || c === "EW") return "EWS";
  if (c === "SC") return "SC";
  if (c === "ST") return "ST";
  return "UR";
}

function cleanCollege(s) {
  // Institute strings in MCC PDFs look like:
  //   "<name>,<name-duplicate>, <address>, <state>, <pincode>"
  //   "<name>, <city>, <state>, <pincode>"
  // Strategy: dedup segments globally, drop trailing pincodes, but KEEP the
  // city qualifier — generic names like "Government Medical College" are
  // useless without their city ("Anantapuramu", "Indore", etc.).
  const trimmed = s.trim().replace(/\s+/g, " ");
  const parts = trimmed.split(",").map(t => t.trim()).filter(Boolean);

  // Dedup case-insensitively, preserve order.
  const seen = new Set();
  const dedup = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(p);
  }

  // Drop trailing pincode-only segments.
  while (dedup.length > 1 && /^\d{6}$/.test(dedup[dedup.length - 1])) dedup.pop();

  // Take up to 2 segments: institute name + location qualifier.
  return dedup.slice(0, 2).join(", ").replace(/\s+/g, " ");
}

// Chunk patterns. MCC PDFs come in two skeleton shapes:
//   "<Rank> <2-char R1 quota code>"      — 2025-R3 trajectory ("6 AI ...")
//   "<SNo> <Rank> <FullQuotaLabel>"      — everything else (R1 flat, R2/R3
//                                          trajectory in 2022-2024, Mop-up,
//                                          Stray)
// We try both and use whichever matches more rows in the PDF.
const FLAT_CHUNK_RE = new RegExp(`\\b(\\d{1,7})\\s+(\\d{1,7})\\s+(?=(?:${FULL_QUOTAS_RE}))`, "g");

const SECTION_HEADERS = [
  /SNo\s+Rank\s+Allotted\s+Quota/i,
  /Round 1 Round 2 Round 3/,
  /Round 1 Round 2/,
];

export function parsePdfText(text, { year, round }) {
  // Skip the legend pages — start at the first table header we can find.
  let body = text;
  let bodyStart = -1;
  for (const re of SECTION_HEADERS) {
    const idx = text.search(re);
    if (idx >= 0 && (bodyStart === -1 || idx < bodyStart)) bodyStart = idx;
  }
  if (bodyStart > 0) body = text.slice(bodyStart);

  // Collapse whitespace, rejoin hyphen-wrapped words ("RADIO- DIAGNOSIS").
  const flat = body.replace(/\s+/g, " ").replace(/([A-Za-z])- ([A-Za-z])/g, "$1-$2");

  const yearN = parseInt(year, 10);
  const normalizedRound = normalizeRound(round);

  // Pick the chunk pattern with more matches.
  const codeChunks = [...flat.matchAll(CHUNK_RE)];
  const flatChunks = [...flat.matchAll(FLAT_CHUNK_RE)];
  const useFlat = flatChunks.length > codeChunks.length;
  const chunkStarts = useFlat ? flatChunks : codeChunks;
  const rankIdx = useFlat ? 2 : 1;

  const records = [];
  const skipped = [];
  for (let i = 0; i < chunkStarts.length; i++) {
    const start = chunkStarts[i].index;
    const end = (i + 1 < chunkStarts.length) ? chunkStarts[i + 1].index : flat.length;
    const chunkText = flat.slice(start, end);
    const rank = parseInt(chunkStarts[i][rankIdx], 10);
    if (!Number.isFinite(rank) || rank < 1 || rank > 1_000_000) continue;

    // Take the LAST TAIL_RE match — for trajectory PDFs that's the final-round
    // allotment; for flat PDFs there's only one match per chunk.
    let last = null;
    TAIL_RE.lastIndex = 0;
    let m;
    while ((m = TAIL_RE.exec(chunkText))) last = m;
    if (!last) {
      if (skipped.length < 200) skipped.push(chunkText.slice(0, 400));
      continue;
    }
    const college = cleanCollege(last[2]);
    // Reject any row whose institute still shows bleed (multiple columns merged).
    if (isBledCollege(college)) {
      if (skipped.length < 200) skipped.push(chunkText.slice(0, 400));
      continue;
    }
    records.push({
      year: yearN, round: normalizedRound, rank,
      college,
      course: last[3].trim().replace(/\s+/g, " "),
      quota: canonicalQuotaLabel(last[1]),
      category: canonicalCandidateCategory(last[5]),
      isPwBD: !!last[6],
    });
  }
  return { records, skipped };
}

/**
 * Scrape an MCC allotment PDF.
 * @param {object} params
 * @param {string} params.url - PDF URL on mcc.nic.in (or any reachable mirror).
 * @param {number|string} params.year - Counseling year (e.g. 2024).
 * @param {string} params.round - Round label (e.g. "R1", "Mop-up", "Stray").
 * @param {boolean} [params.force=false] - Bypass cache and re-download.
 */
export async function scrapeMccPdf({ url, year, round, force = false }) {
  if (!url || !/^https?:\/\//i.test(url)) throw new Error("A valid http(s) URL is required.");
  if (!year) throw new Error("year is required.");
  if (!round) throw new Error("round is required.");

  const key = cacheKey(url, year, round);
  if (!force) {
    const cached = await readCache(key);
    if (cached) return { ...cached, fromCache: true };
  }

  const t0 = Date.now();
  const buf = await downloadPdf(url);
  const downloadedMs = Date.now() - t0;

  // pdf-parse + pdfjs is CPU-heavy (10-15s for a 9MB MCC PDF). Run it in a
  // worker thread so the API can keep serving other requests during the parse.
  const textResult = await extractTextInWorker(buf);
  const parsedMs = Date.now() - t0 - downloadedMs;

  const { records, skipped } = parsePdfText(textResult.text || "", { year, round });

  const payload = {
    source: "MCC",
    url,
    year: parseInt(year, 10),
    round: normalizeRound(round),
    pages: textResult.total,
    bytes: buf.length,
    records,
    skipped,
    skippedCount: skipped.length,
    recordCount: records.length,
    timings: { downloadedMs, parsedMs, totalMs: Date.now() - t0 },
    cachedAt: new Date().toISOString(),
    cacheKey: key,
  };

  await writeCache(key, payload);
  return { ...payload, fromCache: false };
}

/** Load all cached MCC records at server boot — used to seed /api/records. */
export async function loadAllCachedMccRecords() {
  await ensureCacheDir();
  const files = (await fs.readdir(CACHE_DIR)).filter(f => f.startsWith("mcc-") && f.endsWith(".json"));
  const records = [];
  const sources = [];
  for (const f of files) {
    try {
      const raw = await fs.readFile(path.join(CACHE_DIR, f), "utf8");
      const payload = JSON.parse(raw);
      records.push(...(payload.records || []));
      sources.push({ file: f, count: payload.recordCount, year: payload.year, round: payload.round, url: payload.url });
    } catch (e) {
      // Skip corrupt cache file rather than crashing boot.
      // eslint-disable-next-line no-console
      console.warn(`Failed to load cache file ${f}: ${e.message}`);
    }
  }
  return { records, sources };
}
