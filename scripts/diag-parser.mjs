import fs from "node:fs";
import { parsePdfText } from "../server/scrapers/mcc.js";

const file = process.argv[2] || "mcc-r3.txt";
const year = parseInt(process.argv[3] || "2025", 10);
const round = process.argv[4] || "R3";
const text = fs.readFileSync(file, "utf8");

const { records, skipped } = parsePdfText(text, { year, round });

const bleed = /\b(Reported|Surrendered|Did not|Upgrad|Fresh Allotted)\b|- - -/;
let bled = 0;
const colleges = new Set();
const samples = [];
for (const r of records) {
  colleges.add(r.college);
  if (bleed.test(r.college) || (r.college || "").length > 80) {
    bled++;
    if (samples.length < 5) samples.push(r.college.slice(0, 220));
  }
}
console.log(`file=${file} year=${year} round=${round}`);
console.log(`records=${records.length} skipped=${skipped.length} distinctColleges=${colleges.size} bled=${bled} (${(100 * bled / Math.max(1, records.length)).toFixed(1)}%)`);
console.log("\n--- bled college samples ---");
for (const s of samples) console.log(" •", s);
console.log("\n--- clean college samples ---");
let shown = 0;
for (const r of records) {
  if (!bleed.test(r.college) && r.college.length <= 80) { console.log(" •", r.college, "::", r.course); if (++shown >= 8) break; }
}
