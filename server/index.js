/* Ardent MDS API server.
   Endpoints:
     GET  /api/health
     GET  /api/colleges        — bundled NMC PG master list + metadata
     GET  /api/sample-data     — deterministic historical allotment sample
     POST /api/predict         — server-side predictions (mirror of client algo)
     POST /api/backtest        — hold-out backtest calibration table
   Static: serves the Vite build from /dist when present. */

import express from "express";
import compression from "compression";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import {
  COLLEGES, STATES, COLLEGE_TYPES, SPECIALTIES_LIST,
  COLLEGES_DATA_VERSION, COLLEGES_LAST_UPDATED,
} from "../src/lib/colleges.js";
import { generateSampleData, makeSampleCsv } from "../src/lib/sampleData.js";
import { predictAll, runBacktest } from "../src/lib/algo.js";
import { scrapeMccPdf, loadAllCachedMccRecords } from "./scrapers/mcc.js";
import { syncPayloadToSupabase, isServerSupabaseConfigured } from "./lib/supabaseSync.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const PORT = parseInt(process.env.PORT || "8787", 10);

const app = express();
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// In-process caches — deterministic sample is generated once.
let sampleRecordsCache = null;
const getSampleRecords = () => (sampleRecordsCache ??= generateSampleData());

// MCC scraped records loaded from disk at boot. Refreshed in-place when new
// PDFs are imported. Holding in a closure keeps the hot path zero-cost.
let mccRecords = [];
let mccSources = [];
async function refreshMccCache() {
  const { records, sources } = await loadAllCachedMccRecords();
  mccRecords = records;
  mccSources = sources;
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true, ts: Date.now(), version: COLLEGES_DATA_VERSION,
    mcc: { recordCount: mccRecords.length, sourceCount: mccSources.length },
  });
});

app.get("/api/colleges", (req, res) => {
  res.json({
    version: COLLEGES_DATA_VERSION,
    lastUpdated: COLLEGES_LAST_UPDATED,
    states: STATES,
    types: COLLEGE_TYPES,
    specialties: SPECIALTIES_LIST,
    colleges: COLLEGES,
  });
});

app.get("/api/sample-data", (req, res) => {
  const records = getSampleRecords();
  res.json({ count: records.length, records, source: "synthetic" });
});

// Unified records endpoint. Prefers real MCC scraped data when present;
// falls back to the synthetic sample so the app is never empty.
app.get("/api/records", (req, res) => {
  if (mccRecords.length > 0) {
    return res.json({
      count: mccRecords.length,
      records: mccRecords,
      source: "mcc",
      sources: mccSources,
    });
  }
  const records = getSampleRecords();
  res.json({ count: records.length, records, source: "synthetic" });
});

app.get("/api/import/mcc/status", (req, res) => {
  res.json({ recordCount: mccRecords.length, sources: mccSources });
});

app.post("/api/import/mcc", async (req, res) => {
  const { url, year, round, force } = req.body || {};
  if (!url || !year || !round) {
    return res.status(400).json({ error: "url, year, and round are required." });
  }
  try {
    const result = await scrapeMccPdf({ url, year, round, force: !!force });
    // Merge into the in-process cache without rescanning all files (cheap).
    if (!result.fromCache) await refreshMccCache();
    // Persist to Supabase (the source the client reads from) when configured.
    let supabaseSync = { synced: false };
    if (isServerSupabaseConfigured) {
      try {
        supabaseSync = await syncPayloadToSupabase(result);
      } catch (e) {
        supabaseSync = { synced: false, error: e.message };
        // eslint-disable-next-line no-console
        console.error("Supabase sync failed:", e.message);
      }
    }
    // Don't send the raw `skipped` lines back unless asked — they can be huge.
    const { skipped, ...summary } = result;
    res.json({ ...summary, supabaseSync, skippedSample: (skipped || []).slice(0, 10) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("MCC import failed:", err);
    res.status(500).json({ error: err.message || "Import failed." });
  }
});

app.get("/api/sample-template.csv", (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=neet-pg-sample-template.csv");
  res.send(makeSampleCsv());
});

app.post("/api/predict", (req, res) => {
  const { student, records } = req.body || {};
  if (!student || typeof student !== "object") return res.status(400).json({ error: "Missing student profile" });
  if (!Array.isArray(records)) return res.status(400).json({ error: "Missing records array" });
  if (!student.neetPgRank) return res.json({ predictions: [] });
  const predictions = predictAll(student, records);
  res.json({ predictions, count: predictions.length });
});

app.post("/api/backtest", (req, res) => {
  const { records } = req.body || {};
  if (!Array.isArray(records)) return res.status(400).json({ error: "Missing records array" });
  res.json(runBacktest(records));
});

// Serve the Vite build in production.
const distDir = path.join(ROOT, "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distDir, "index.html"));
  });
}

// Boot: load cached MCC PDFs before accepting connections so /api/records is
// instantly correct.
refreshMccCache().then(() => {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
      `Ardent MDS API listening on http://localhost:${PORT}` +
      ` — MCC cache: ${mccRecords.length} records across ${mccSources.length} sources`
    );
  });
}).catch(err => {
  // eslint-disable-next-line no-console
  console.warn("MCC cache load failed; continuing with synthetic sample.", err);
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Ardent MDS API listening on http://localhost:${PORT} (no MCC cache)`);
  });
});
