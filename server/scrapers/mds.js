/* NEET-MDS (dental) allotment PDF parser.

   MCC publishes MDS counselling results in two distinct layouts:

   1. TRAJECTORY  (2022 R2, 2023 R3, 2024 R3): a per-candidate row spanning the
      counselling rounds —
        <SNo> <Rank> <R1quota> <R1institute> <R1course> <remark>
              [<R2…>] [<R3quota> <R3institute> <R3course> <allottedCat> <candCat> <opt> <remark>]
      The FINAL allotment is the LAST (quota → institute → course) triple in the
      candidate's chunk. Category only appears for upgraded candidates.

   2. ADMITTED LIST (2025 "Admitted/Joined Candidates upto Round 3"):
        <RollNo(10)> <Name> <Quota> <AIR> <Institute,address> <Subject> <Round>
      No category column; carries candidate names (PII — dropped).

   Why whitespace-insensitive matching:
   pdf-parse flattens MCC's narrow columns and breaks words at fixed widths
   ("ORTHODONTICS" → "ORTHODO\nNTICS", "Management" → "Manageme\nnt"). So we
   anchor on the KNOWN, enumerable set of MDS quotas and dental specialties,
   matching each canonical token with optional whitespace between every char.
*/

import { normalizeRound } from "../../src/lib/normalize.js";

// ── Canonical vocab ────────────────────────────────────────────────────────
// Quota labels as they appear in the PDF (longest/most-specific first so the
// alternation prefers e.g. "…Quota" over its bare prefix).
const QUOTA_LABELS = [
  "Management/Paid Seats Quota", "Management/Paid Seats",
  "All India",
  "Delhi University Quota", "Delhi University",
  "Banaras Hindu University",
  "Muslim Minority Quota", "Muslim Minority",
  "Aligarh Muslim University",
  "Non-Resident Indian",
  "Jain Minority Quota", "Jain Minority",
  "Armed Forces Medical",
];
const QUOTA_DISPLAY = {
  "MANAGEMENT/PAIDSEATSQUOTA": "Management", "MANAGEMENT/PAIDSEATS": "Management",
  "ALLINDIA": "AIQ",
  "DELHIUNIVERSITYQUOTA": "Delhi University", "DELHIUNIVERSITY": "Delhi University",
  "BANARASHINDUUNIVERSITY": "Banaras Hindu University",
  "MUSLIMMINORITYQUOTA": "Muslim Minority", "MUSLIMMINORITY": "Muslim Minority",
  "ALIGARHMUSLIMUNIVERSITY": "Aligarh Muslim University",
  "NON-RESIDENTINDIAN": "NRI",
  "JAINMINORITYQUOTA": "Jain Minority", "JAINMINORITY": "Jain Minority",
  "ARMEDFORCESMEDICAL": "AFMS",
};

// The standard MDS dental specialties (longest/most-specific first).
const COURSE_LABELS = [
  "ORAL AND MAXILLOFACIAL PATHOLOGY AND ORAL MICROBIOLOGY",
  "ORAL AND MAXILLOFACIAL SURGERY",
  "ORAL MEDICINE AND RADIOLOGY",
  "PROSTHODONTICS AND CROWN AND BRIDGE",
  "CONSERVATIVE DENTISTRY AND ENDODONTICS",
  "ORTHODONTICS AND DENTOFACIAL ORTHOPEDICS",
  "PEDODONTICS AND PREVENTIVE DENTISTRY",
  "PEDIATRIC AND PREVENTIVE DENTISTRY",
  "PUBLIC HEALTH DENTISTRY",
  "PERIODONTOLOGY",
];
const COURSE_DISPLAY = {
  "ORALANDMAXILLOFACIALPATHOLOGYANDORALMICROBIOLOGY": "Oral and Maxillofacial Pathology and Oral Microbiology",
  "ORALANDMAXILLOFACIALSURGERY": "Oral and Maxillofacial Surgery",
  "ORALMEDICINEANDRADIOLOGY": "Oral Medicine and Radiology",
  "PROSTHODONTICSANDCROWNANDBRIDGE": "Prosthodontics and Crown and Bridge",
  "CONSERVATIVEDENTISTRYANDENDODONTICS": "Conservative Dentistry and Endodontics",
  "ORTHODONTICSANDDENTOFACIALORTHOPEDICS": "Orthodontics and Dentofacial Orthopedics",
  "PEDODONTICSANDPREVENTIVEDENTISTRY": "Pediatric and Preventive Dentistry",
  "PEDIATRICANDPREVENTIVEDENTISTRY": "Pediatric and Preventive Dentistry",
  "PUBLICHEALTHDENTISTRY": "Public Health Dentistry",
  "PERIODONTOLOGY": "Periodontology",
};

// Build a whitespace-tolerant regex source for a literal label: collapse the
// label's own spaces, then allow \s* between every character.
const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const spaced = (label) =>
  label.replace(/\s+/g, "").split("").map(esc).join("\\s*");

const QUOTA_SRC = QUOTA_LABELS.map(spaced).join("|");
const COURSE_SRC = COURSE_LABELS.map(spaced).join("|");

const key = (s) => s.replace(/\s+/g, "").toUpperCase();
const canonQuota = (raw) => QUOTA_DISPLAY[key(raw)] || raw.replace(/\s+/g, " ").trim();
const canonCourse = (raw) => COURSE_DISPLAY[key(raw)] || raw.replace(/\s+/g, " ").trim();

// Candidate category code → app canonical.
function canonCategory(code) {
  switch ((code || "").toUpperCase()) {
    case "GN": case "GEN": case "GENERAL": return "UR";
    case "BC": case "OBC": return "OBC-NCL";
    case "EW": case "EWS": return "EWS";
    case "SC": return "SC";
    case "ST": return "ST";
    default: return null;
  }
}

// Institute string → "<name>[, <city>]"; dedup repeated segments, drop pincodes.
function cleanCollege(s) {
  const trimmed = s.replace(/\s+/g, " ").trim().replace(/^[,\s]+|[,\s]+$/g, "");
  const parts = trimmed.split(",").map((t) => t.trim()).filter(Boolean);
  const seen = new Set();
  const dedup = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(p);
  }
  while (dedup.length > 1 && /^\d{4,6}$/.test(dedup[dedup.length - 1])) dedup.pop();
  return dedup.slice(0, 2).join(", ");
}

function isBadCollege(name) {
  const c = (name || "").trim();
  return c.length < 3 || c.length > 110;
}

// ── Trajectory format (2022–2024) ───────────────────────────────────────────
const CHUNK_RE = new RegExp(`\\b(\\d{1,6})\\s+(\\d{1,7})\\s+(?=(?:${QUOTA_SRC})\\b)`, "gi");
const TRIPLE_RE = new RegExp(`(${QUOTA_SRC})\\s+(.+?)\\s+(${COURSE_SRC})`, "gi");
// Category tail after the final course: "<allottedCat> <candCat>[ PwD] <opt> <action>".
const CAT_RE = /\b(?:Open|Reserve|General|[A-Z]{2,3})\s+(GN|SC|ST|BC|EW|OBC|EWS)(\s+PwD)?\b/i;

export function parseMdsTrajectory(text, { year, round }) {
  const flat = text.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, " ")
                   .replace(/Page\s+\d+\s+of\s+\d+/gi, " ")
                   .replace(/\s+/g, " ");
  const yearN = parseInt(year, 10);
  const normalizedRound = normalizeRound(round);

  const starts = [...flat.matchAll(CHUNK_RE)];
  const records = [];
  const skipped = [];

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index;
    const end = i + 1 < starts.length ? starts[i + 1].index : flat.length;
    const chunk = flat.slice(start, end);
    const rank = parseInt(starts[i][2], 10);
    if (!Number.isFinite(rank) || rank < 1 || rank > 5_000_000) continue;

    // Last (quota → institute → course) triple = the final-round allotment.
    let last = null;
    TRIPLE_RE.lastIndex = 0;
    let m;
    while ((m = TRIPLE_RE.exec(chunk))) last = m;
    if (!last) { if (skipped.length < 200) skipped.push(chunk.slice(0, 300)); continue; }

    const college = cleanCollege(last[2]);
    if (isBadCollege(college)) { if (skipped.length < 200) skipped.push(chunk.slice(0, 300)); continue; }

    // Category lives just after the final course (only for upgraded candidates).
    const afterCourse = chunk.slice(last.index + last[0].length, last.index + last[0].length + 60);
    const catMatch = afterCourse.match(CAT_RE);

    records.push({
      stream: "MDS",
      year: yearN,
      round: normalizedRound,
      rank,
      college,
      course: canonCourse(last[3]),
      quota: canonQuota(last[1]),
      category: catMatch ? canonCategory(catMatch[1]) : null,
      state: undefined,
      isPwBD: !!(catMatch && catMatch[2]),
    });
  }
  return { records, skipped };
}

// ── Admitted-list format (2025) ─────────────────────────────────────────────
// <RollNo(10)> <Name> <Quota> <AIR> <Institute,address> <Subject> <Round>
const ADMIT_RE = new RegExp(
  `\\b\\d{10}\\s+.+?\\s+(${QUOTA_SRC})\\s+(\\d{1,7})\\s+(.+?)\\s+(${COURSE_SRC})\\s+(\\d)\\b`,
  "gi"
);

export function parseMdsAdmittedList(text, { year, round = "Admitted" }) {
  const flat = text.replace(/Page\s+\d+\s+of\s+\d+/gi, " ")
                   .replace(/Rollno\s+Name\s+QuotaName\s+AIR\s+Institute\s+Subject\s+AdmittedRound/gi, " ")
                   .replace(/Admitted\/Joined Candidates List[^]*?Counselling/gi, " ")
                   .replace(/\s+/g, " ");
  const yearN = parseInt(year, 10);
  const records = [];
  const skipped = [];

  let m;
  ADMIT_RE.lastIndex = 0;
  while ((m = ADMIT_RE.exec(flat))) {
    const rank = parseInt(m[2], 10);
    const college = cleanCollege(m[3]);
    if (!Number.isFinite(rank) || rank < 1 || isBadCollege(college)) {
      if (skipped.length < 200) skipped.push(m[0].slice(0, 200));
      continue;
    }
    records.push({
      stream: "MDS",
      year: yearN,
      round: normalizeRound(round),
      rank,
      college,
      course: canonCourse(m[4]),
      quota: canonQuota(m[1]),
      category: null,        // admitted-list carries no category
      state: undefined,
      isPwBD: false,
    });
  }
  return { records, skipped };
}

// ── Detection / dispatch ─────────────────────────────────────────────────────
export function isMdsPdf(text) {
  const head = text.slice(0, 4000);
  return /\bMDS\b/i.test(head) && /(Dental|DENTISTRY|MAXILLOFACIAL|ORTHODONTICS|MDS Counselling)/i.test(head);
}
export function isAdmittedList(text) {
  return /Rollno\s+Name\s+QuotaName\s+AIR\s+Institute\s+Subject\s+AdmittedRound/i.test(text.slice(0, 6000))
      || /Admitted\/Joined Candidates List/i.test(text.slice(0, 6000));
}

export function parseMdsText(text, { year, round }) {
  return isAdmittedList(text)
    ? parseMdsAdmittedList(text, { year, round })
    : parseMdsTrajectory(text, { year, round });
}
