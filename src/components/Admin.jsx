/* AdminPanel — slide-over modal with Data / Master-list / Methodology tabs. */
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Field, Toggle, Kpi, usePagination, Pagination, Select } from "./ui.jsx";
// Methodology now lives at its own /#methodology route, not inside admin.
import {
  COLLEGES, STATES, COLLEGE_TYPES, SPECIALTIES_LIST,
  collegeMatchesQuery,
} from "../lib/colleges.js";
import { generateSampleData, makeSampleCsv } from "../lib/sampleData.js";
import { normalizeCategory, normalizeQuota, normalizeRound, normalizeBool } from "../lib/normalize.js";
import { isSupabaseConfigured, fetchAllotmentRecords } from "../lib/supabase.js";
import { isProfileComplete, missingProfileFields } from "../lib/profile.js";

const ADMIN_EMAIL = "admin@ardent.mds";
const ADMIN_PASS = "Admin@123";

// NEET PG All India Rank is bounded ~1..250,000. Numbers outside this range
// almost certainly indicate a typo (or the candidate confused rank with score).
export function rankError(rank) {
  if (!rank) return null; // empty is fine — just no predictions yet
  if (rank < 1) return "Rank must be at least 1.";
  if (rank > 250000) return "Rank looks too high — NEET PG ranks rarely exceed 250,000.";
  if (!Number.isInteger(rank)) return "Rank must be a whole number.";
  return null;
}

function adminParseCsv(text) {
  const rows = [];
  let i = 0, field = "", row = [], inQ = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ""; i++; continue; }
    if (ch === '\n' || ch === '\r') {
      if (field !== "" || row.length) { row.push(field); rows.push(row); }
      field = ""; row = [];
      while (text[i] === '\n' || text[i] === '\r') i++;
      continue;
    }
    field += ch; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function autoMap(headers) {
  const norm = h => h.toLowerCase().replace(/[^a-z]/g, "");
  const m = {};
  const find = (...cands) => headers.find(h => cands.some(c => norm(h).includes(c)));
  m.year = find("year"); m.round = find("round"); m.rank = find("rank");
  m.college = find("college","institute","institution");
  m.course = find("course","specialty","speciality","branch");
  m.category = find("category","cat","reservation");
  m.quota = find("quota","scheme");
  m.state = find("state","domicile");
  m.isPwBD = find("pwbd","pwd","disability","disabled");
  m.isInService = find("inservice","service");
  return m;
}

export function AdminPanel({ open, onClose, records, setRecords, student, setStudent, initialTab }) {
  const [tab, setTab] = useState(initialTab || "data");
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("ardent_mds_admin_authed") === "1");
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab, open]);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;

  const onAuthed = () => { sessionStorage.setItem("ardent_mds_admin_authed", "1"); setAuthed(true); };
  const onLogout = () => { sessionStorage.removeItem("ardent_mds_admin_authed"); setAuthed(false); };

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="Admin panel">
        {!authed ? (
          <AdminLogin onAuthed={onAuthed} onClose={onClose} />
        ) : (
          <>
            <div className="admin-header">
              <div>
                <div className="eyebrow" style={{color:"var(--brand-orange)"}}>Admin</div>
                <div className="h3" style={{margin:"4px 0 0"}}>Control panel</div>
              </div>
              <div className="hflex" style={{gap: 8}}>
                <button className="btn ghost sm" onClick={onLogout}>Sign out</button>
                <button className="btn ghost sm" onClick={onClose}>Close ✕</button>
              </div>
            </div>
            <div className="admin-tabs">
              {[
                { k: "data", label: "Data" },
                { k: "colleges", label: "Master list" },
              ].map(t => (
                <div key={t.k} className={"admin-tab " + (tab === t.k ? "active" : "")} onClick={() => setTab(t.k)}>
                  {t.label}
                </div>
              ))}
            </div>
            <div className="admin-body">
              {tab === "data"        && <DataTab records={records} setRecords={setRecords} />}
              {tab === "colleges"    && <CollegesTab records={records} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AdminLogin({ onAuthed, onClose }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const submit = (e) => {
    e.preventDefault();
    if (email.trim().toLowerCase() !== ADMIN_EMAIL || pass !== ADMIN_PASS) {
      setErr("Incorrect email or password.");
      return;
    }
    onAuthed();
  };
  return (
    <div style={{padding: "48px 32px", maxWidth: 480, margin: "auto", width: "100%"}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom: 36}}>
        <div className="topnav-brand" style={{cursor:"default"}}>
          <img className="brandmark" src="/logo.jpg" alt="Ardent" />
          <span className="brandname"><em>Ardent</em></span>
        </div>
        <button className="btn ghost sm" onClick={onClose}>Close ✕</button>
      </div>

      <div className="eyebrow" style={{color:"var(--brand-orange)"}}>Admin access</div>
      <h2 className="h2" style={{margin:"4px 0 8px"}}>Sign in to continue</h2>
      <p className="subtitle" style={{margin:"0 0 28px", fontSize: 15}}>
        The admin console is restricted — it ingests historical allotment data and imports MCC PDFs into the database.
      </p>

      <form onSubmit={submit} className="vflex" style={{gap: 16}}>
        <Field label="Email">
          <input type="email" className="input" value={email} autoFocus
                 onChange={e => { setErr(""); setEmail(e.target.value); }}
                 placeholder="admin@ardent.mds" />
        </Field>
        <Field label="Password">
          <input type="password" className="input" value={pass}
                 onChange={e => { setErr(""); setPass(e.target.value); }}
                 placeholder="••••••••" />
        </Field>
        {err && (
          <div style={{
            background: "var(--brand-orange-soft)", color: "var(--brand-orange-deep)",
            padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
            border: "1px solid var(--brand-orange-tint)"
          }}>{err}</div>
        )}
        <button className="btn primary" type="submit" style={{width: "100%", marginTop: 4}}>
          Sign in →
        </button>
      </form>

      <p className="footnote mt-8" style={{color:"var(--ink-faint)"}}>
        Session-only — sign out, refresh, or close the tab to clear.
      </p>
    </div>
  );
}

function DataTab({ records, setRecords }) {
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [mcc, setMcc] = useState({ url: "", year: new Date().getFullYear(), round: "R1" });
  const [mccBusy, setMccBusy] = useState(false);
  const [mccResult, setMccResult] = useState(null);
  const [mccError, setMccError] = useState(null);

  const runMccImport = async (force = false) => {
    setMccBusy(true); setMccError(null); setMccResult(null);
    try {
      const res = await fetch("/api/import/mcc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...mcc, force }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMccResult(json);
    } catch (err) {
      setMccError(err.message);
    } finally {
      setMccBusy(false);
    }
  };

  const commitMcc = async () => {
    if (!mccResult) return;
    try {
      // When Supabase is the source, the import already synced there — re-pull
      // from it. Otherwise fall back to the server's in-memory /api/records.
      if (isSupabaseConfigured) {
        const recs = await fetchAllotmentRecords();
        setRecords(recs);
      } else {
        const res = await fetch("/api/records");
        const json = await res.json();
        if (Array.isArray(json.records)) setRecords(json.records);
      }
      setMccResult(r => r ? { ...r, _committed: true } : r);
    } catch (err) {
      setMccError(err.message);
    }
  };

  const handleFiles = async (fileList) => {
    const arr = Array.from(fileList);
    for (const f of arr) {
      const ext = f.name.split(".").pop().toLowerCase();
      try {
        if (ext === "csv" || ext === "txt") {
          const text = await f.text();
          const rows = adminParseCsv(text);
          const headers = rows[0].map(h => h.trim());
          const dataRows = rows.slice(1).filter(r => r.some(c => c.trim() !== ""));
          const parsed = dataRows.map(r => { const o = {}; headers.forEach((h, i) => o[h] = r[i]); return o; });
          setFiles(prev => [...prev, { id: Math.random().toString(36).slice(2), name: f.name, headers, rows: parsed, mapping: autoMap(headers), committed: false }]);
        } else {
          alert(`File ${f.name} is not CSV. Please upload CSV.`);
        }
      } catch (e) { alert(`Failed to parse ${f.name}: ${e.message}`); }
    }
  };
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); };
  const loadSample = () => setRecords(generateSampleData());

  const commitFile = (id) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== id) return f;
      const m = f.mapping;
      const reqMissing = ["year","rank","college","course"].filter(k => !m[k]);
      if (reqMissing.length) {
        alert(`Cannot commit: required column mapping missing for ${reqMissing.join(", ")}.`);
        return f;
      }
      const candidate = f.rows.map(r => ({
        year: parseInt(r[m.year]),
        round: normalizeRound(r[m.round]),
        rank: parseInt(r[m.rank]),
        college: (r[m.college] || "").trim(),
        course: (r[m.course] || "").trim(),
        category: normalizeCategory(r[m.category]),
        quota: normalizeQuota(r[m.quota]),
        state: r[m.state] ? r[m.state].trim() : undefined,
        isPwBD: normalizeBool(r[m.isPwBD]),
        isInService: normalizeBool(r[m.isInService]),
      }));
      const newRecs = candidate.filter(r =>
        !isNaN(r.year) && !isNaN(r.rank) && r.rank > 0 && r.college && r.course
      );
      const skipped = candidate.length - newRecs.length;
      setRecords(prev => [...prev, ...newRecs]);
      return { ...f, committed: true, committedN: newRecs.length, skipped };
    }));
  };
  const discardFile = (id) => setFiles(prev => prev.filter(f => f.id !== id));

  const summary = useMemo(() => {
    if (!records.length) return null;
    const colleges = new Set(records.map(r => r.college));
    const years = new Set(records.map(r => r.year));
    const rounds = new Set(records.map(r => r.round));
    return { n: records.length, colleges: colleges.size, years: years.size, rounds: rounds.size };
  }, [records]);

  const downloadSampleCsv = () => {
    const csv = makeSampleCsv();
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "neet-pg-sample-template.csv";
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-6">
        <h3 className="h3" style={{margin:0}}>Historical allotment data</h3>
        <p className="subtitle" style={{margin:"6px 0 0", fontSize:14}}>Drop CSVs covering past NEET PG allotment rounds. Everything is processed locally; nothing is uploaded.</p>
      </div>

      <div className={"dropzone " + (dragOver ? "over" : "")}
           onDragOver={e => { e.preventDefault(); setDragOver(true); }}
           onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
        <div className="big">Drop CSVs here</div>
        <p style={{margin:"10px 0 14px", color:"var(--ink-muted)", fontSize:14}}>
          or&nbsp;
          <label className="btn secondary sm" style={{cursor:"pointer"}}>
            Choose files
            <input type="file" multiple accept=".csv,.txt" style={{display:"none"}} onChange={e => handleFiles(e.target.files)} />
          </label>
          &nbsp;or&nbsp;
          <button className="btn primary sm" onClick={loadSample}>Load sample dataset</button>
        </p>
        <p className="footnote">
          Required columns: <span className="mono">year, round, rank, college, course, category, quota</span>.
          Optional: <span className="mono">state, isPwBD, isInService</span>.&nbsp;
          <a onClick={downloadSampleCsv} style={{color:"var(--brand-orange)", cursor:"pointer", fontWeight:600}}>Download template ↓</a>
        </p>
      </div>

      {files.length > 0 && (
        <div className="vflex mt-6" style={{gap: 14}}>
          {files.map(f => (
            <AdminFilePanel key={f.id} file={f}
              onMappingChange={(m) => setFiles(prev => prev.map(x => x.id === f.id ? {...x, mapping: {...x.mapping, ...m}} : x))}
              onCommit={() => commitFile(f.id)} onDiscard={() => discardFile(f.id)} />
          ))}
        </div>
      )}

      <div className="panel mt-6">
        <div className="spread mb-3" style={{flexWrap:"wrap", gap: 8}}>
          <div>
            <div className="eyebrow">Real data · MCC AIQ</div>
            <div className="h4" style={{margin: "4px 0 0"}}>Import from MCC allotment PDF</div>
            <p className="footnote mt-2" style={{maxWidth: 620}}>
              Paste the URL of an official MCC allotment PDF (from <span className="mono">mcc.nic.in</span>).
              The server downloads, parses, normalizes, and caches it on disk — repeat imports are instant.
              Note: MCC PDF URLs are session-bound and change every counseling cycle.
            </p>
          </div>
        </div>
        <div className="grid cols-3 tight mb-3">
          <Field label="Year">
            <input type="number" className="input num" value={mcc.year} min="2018" max="2030"
              onChange={e => setMcc(s => ({...s, year: parseInt(e.target.value) || s.year}))}/>
          </Field>
          <Field label="Round">
            <Select value={mcc.round}
              options={["R1","R2","R3","Mop-up","Stray"]}
              onChange={v => setMcc(s => ({...s, round: v}))} />
          </Field>
          <Field label="PDF URL" hint="Direct link to the MCC allotment PDF.">
            <input type="url" className="input" placeholder="https://mcc.nic.in/.../Result_PG_R1.pdf"
              value={mcc.url}
              onChange={e => setMcc(s => ({...s, url: e.target.value}))}/>
          </Field>
        </div>
        <div className="hflex" style={{gap: 8}}>
          <button className="btn primary sm" disabled={!mcc.url || mccBusy}
            onClick={() => runMccImport(false)}>
            {mccBusy ? "Fetching & parsing…" : "Fetch & parse →"}
          </button>
          <button className="btn ghost sm" disabled={!mcc.url || mccBusy}
            onClick={() => runMccImport(true)}>
            Re-parse (bypass cache)
          </button>
        </div>

        {mccError && (
          <div className="mt-4" style={{
            background: "var(--brand-orange-soft)", color: "var(--brand-orange-deep)",
            padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
            border: "1px solid var(--brand-orange-tint)"
          }}>{mccError}</div>
        )}

        {mccResult && (
          <div className="panel sunken mt-4">
            <div className="spread mb-3" style={{flexWrap:"wrap", gap:8}}>
              <div>
                <div className="eyebrow" style={{color: mccResult._committed ? "var(--tier-safe)" : "var(--brand-orange)"}}>
                  {mccResult._committed ? "Committed" : (mccResult.fromCache ? "Loaded from cache" : "Parsed")}
                </div>
                <div className="h4" style={{margin:"4px 0 0"}}>
                  {mccResult.year} · {mccResult.round} · {mccResult.recordCount.toLocaleString("en-IN")} records
                </div>
                <p className="footnote mt-2">
                  {mccResult.pages != null && <>Pages: <span className="mono">{mccResult.pages}</span> · </>}
                  Bytes: <span className="mono">{mccResult.bytes?.toLocaleString("en-IN") || "—"}</span>
                  {mccResult.timings && <> · Parse: <span className="mono">{mccResult.timings.totalMs} ms</span></>}
                  {mccResult.skippedCount > 0 && (
                    <> · <span style={{color:"var(--brand-orange)", fontWeight:600}}>{mccResult.skippedCount} unparsed lines</span></>
                  )}
                </p>
              </div>
              {!mccResult._committed && (
                <div className="hflex" style={{gap: 8}}>
                  <button className="btn primary sm" onClick={commitMcc}>Use this data ✓</button>
                </div>
              )}
            </div>

            {mccResult.skippedSample && mccResult.skippedSample.length > 0 && (
              <details style={{marginTop: 8}}>
                <summary className="footnote" style={{cursor:"pointer", fontWeight: 600}}>
                  Show sample of unparsed lines ({mccResult.skippedSample.length})
                </summary>
                <pre className="mono" style={{
                  fontSize: 11, background: "white", padding: 12, borderRadius: 6,
                  marginTop: 8, maxHeight: 200, overflow: "auto", border: "1px solid var(--rule)"
                }}>{mccResult.skippedSample.join("\n")}</pre>
              </details>
            )}
          </div>
        )}
      </div>

      {summary && (
        <>
          <div className="grid cols-4 mt-8">
            <Kpi label="Records" value={summary.n.toLocaleString("en-IN")} sub="allotment rows"/>
            <Kpi label="Colleges" value={summary.colleges.toLocaleString("en-IN")} sub="distinct"/>
            <Kpi label="Years" value={summary.years} sub="historical coverage"/>
            <Kpi label="Rounds" value={summary.rounds} sub="distinct"/>
          </div>
          <div className="spread mt-6">
            <p className="footnote">Ingested data is held in-memory only. Refresh clears it.</p>
            <button className="btn ghost sm" onClick={() => setRecords([])}>Clear all data</button>
          </div>
        </>
      )}
    </div>
  );
}

function AdminFilePanel({ file, onMappingChange, onCommit, onDiscard }) {
  if (file.committed) {
    return (
      <div className="panel" style={{borderColor:"var(--tier-safe)", borderWidth: 1}}>
        <div className="spread">
          <div>
            <div className="eyebrow" style={{color:"var(--tier-safe)"}}>Committed</div>
            <div className="h4" style={{margin: "4px 0 0"}}>{file.name}</div>
            <p className="footnote mt-2">
              {file.committedN.toLocaleString("en-IN")} records added.
              {file.skipped > 0 && (
                <> · <span style={{color:"var(--brand-orange)", fontWeight:600}}>{file.skipped.toLocaleString("en-IN")} skipped</span> (missing year, rank, college, or course)</>
              )}
            </p>
          </div>
          <span style={{color:"var(--tier-safe)", fontSize: 20, fontWeight: 800}}>✓</span>
        </div>
      </div>
    );
  }
  const reqFields = ["year","round","rank","college","course","category","quota"];
  const optFields = ["state","isPwBD","isInService"];
  return (
    <div className="panel">
      <div className="spread mb-3">
        <div>
          <div className="eyebrow">Inspect & map</div>
          <div className="h4" style={{margin: "4px 0 0"}}>{file.name}</div>
          <p className="footnote mt-2">{file.rows.length.toLocaleString("en-IN")} rows · {file.headers.length} columns</p>
        </div>
        <div className="hflex" style={{gap: 8}}>
          <button className="btn ghost sm" onClick={onDiscard}>Discard</button>
          <button className="btn primary sm" onClick={onCommit}>Commit ✓</button>
        </div>
      </div>
      <div className="eyebrow mb-2">Detected columns</div>
      <div className="hflex mb-4" style={{gap: 6, flexWrap:"wrap"}}>
        {file.headers.map(h => <span key={h} className="chip mono">{h}</span>)}
      </div>
      <div className="eyebrow mb-2">Column mapping</div>
      <div className="grid cols-3 tight">
        {[...reqFields, ...optFields].map(field => (
          <Field key={field} label={field + (reqFields.includes(field) ? " *" : "")}>
            <Select value={file.mapping[field] || ""}
              options={[{value:"", label:"— none —"}, ...file.headers]}
              onChange={v => onMappingChange({[field]: v})}
              placeholder="— none —" />
          </Field>
        ))}
      </div>
      <div className="eyebrow mt-6 mb-2">Preview · first 8 rows</div>
      <div className="table-wrap" style={{maxHeight: 200, overflow:"auto"}}>
        <table className="table" style={{fontSize: 12}}>
          <thead><tr>{file.headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {file.rows.slice(0, 8).map((r, i) => (
              <tr key={i}>{file.headers.map(h => <td key={h} className={/rank|year/i.test(h) ? "num" : ""}>{r[h]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProfileTab({ student, setStudent, onContinue, stream = "PG", records = [] }) {
  const setField = (k, v) => setStudent(s => ({...s, [k]: v}));
  const missing = missingProfileFields(student);
  const complete = missing.length === 0;
  // PG ships a curated medical-specialty list; MDS has no bundled list, so
  // derive dental specialties from whatever courses the loaded records carry.
  const specialtyOptions = useMemo(() => {
    if (stream !== "MDS") return SPECIALTIES_LIST;
    const set = new Set();
    for (const r of records) if (r.course) set.add(r.course);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [stream, records]);
  return (
    <div>
      <div className="mb-6">
        <h3 className="h3" style={{margin:0}}>Candidate profile</h3>
        <p className="subtitle" style={{margin:"6px 0 0", fontSize:14}}>Complete the required fields (marked <span style={{color:"var(--brand-orange)"}}>*</span>) to generate your predictions. Every modelled field affects rank-based allotment; religion is the one exception — used solely to surface minority-institution eligibility.</p>
      </div>

      <div className="panel mb-6">
        <div className="eyebrow mb-3">Identification</div>
        <div className="grid cols-2 tight">
          <Field label="Full name *">
            <input type="text" className="input" value={student.name || ""} placeholder="e.g. Aakash Kummar"
                   onChange={e => setField("name", e.target.value)} />
          </Field>
          <Field label="Registration number" hint="NEET PG registration / roll no.">
            <input type="text" className="input mono" value={student.regNumber || ""} placeholder="e.g. 240XXXXXXX"
                   onChange={e => setField("regNumber", e.target.value)} />
          </Field>
          <Field label="Mobile number *" hint="10-digit mobile">
            <input type="tel" className="input num" value={student.mobile || ""} placeholder="9XXXXXXXXX"
                   inputMode="numeric" maxLength={10} autoComplete="tel-national"
                   onChange={e => setField("mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} />
          </Field>
          <Field label="Age">
            <input type="number" className="input num" value={student.age || ""} placeholder="e.g. 26"
                   min="20" max="65" onChange={e => setField("age", parseInt(e.target.value) || 0)} />
          </Field>
          <Field label="Gender">
            <Select value={student.gender || ""}
              options={["Female","Male","Non-binary","Prefer not to say"]}
              onChange={v => setField("gender", v)} />
          </Field>
          <Field label="Attempt number" hint="Which NEET PG attempt is this?">
            <Select value={student.attemptNo || ""}
              options={[
                {value:1, label:"1st (first attempt)"},
                {value:2, label:"2nd attempt"},
                {value:3, label:"3rd attempt"},
                {value:4, label:"4th attempt"},
                {value:5, label:"5+ attempts"},
              ]}
              onChange={v => setField("attemptNo", v ? parseInt(v) : "")} />
          </Field>
        </div>
        <p className="footnote mt-4" style={{color:"var(--ink-faint)"}}>
          Stored locally only — used to personalise your prediction dossier. Gender and age do <em>not</em> affect rank-based allotment and are not inputs to the model.
        </p>
      </div>

      <div className="panel mb-6">
        <div className="eyebrow mb-3">Primary inputs <span style={{color:"var(--brand-orange)"}}>· modelled</span></div>
        <div className="grid cols-2 tight">
          <Field label="NEET PG / MDS Rank *" hint={rankError(student.neetPgRank) || "Your All India Rank (1 – 250,000)"}>
            <input type="number" className="input num"
                   value={student.neetPgRank || ""} placeholder="e.g. 12847"
                   min="1" max="250000" inputMode="numeric"
                   style={rankError(student.neetPgRank) ? {borderColor:"var(--brand-orange)", boxShadow:"0 0 0 3px var(--brand-orange-soft)"} : null}
                   onChange={e => {
                     const v = e.target.value;
                     setField("neetPgRank", v === "" ? 0 : Math.max(0, parseInt(v) || 0));
                   }}/>
          </Field>
          <Field label="Category">
            <Select value={student.category}
              options={["UR","EWS","OBC-NCL","SC","ST"]}
              onChange={v => setField("category", v)} />
          </Field>
          <Field label="Domicile state *" hint="Required for state quota pools">
            <Select value={student.domicileState || ""}
              options={STATES}
              onChange={v => setField("domicileState", v)} />
          </Field>
          <Field label="Religion" hint="Flag for minority-institution eligibility only">
            <Select value={student.religion || ""}
              options={[{value:"", label:"— Prefer not to say —"}, "Hindu","Christian","Muslim","Sikh","Other"]}
              onChange={v => setField("religion", v)}
              placeholder="— Prefer not to say —" />
          </Field>
        </div>
        <div className="hflex mt-4" style={{gap: 28, flexWrap:"wrap", rowGap: 14}}>
          <Toggle checked={!!student.isPwBD} onChange={v => setField("isPwBD", v)} label="PwBD (5% horizontal)" />
          <Toggle checked={!!student.isInService} onChange={v => setField("isInService", v)} label="In-service (state quota)" />
          <Toggle checked={!!student.isESICBeneficiary} onChange={v => setField("isESICBeneficiary", v)} label="ESIC beneficiary" />
          <Toggle checked={!!student.isAFMSCandidate} onChange={v => setField("isAFMSCandidate", v)} label="AFMS candidate" />
        </div>
        <p className="footnote mt-3" style={{color:"var(--ink-faint)"}}>
          In-service eligibility unlocks the state in-service pool only when a domicile state is set.
          ESIC and AFMS pools require explicit eligibility — they are not available to every candidate.
        </p>
      </div>

      <div className="panel mb-6">
        <div className="eyebrow mb-3">Optional preferences</div>
        <Field label="Specialties of interest">
          <MultiSelect options={specialtyOptions} value={student.preferredSpecialties || []}
            onChange={v => setField("preferredSpecialties", v)} placeholder="Pick one or more…"/>
        </Field>
        <div className="mt-4">
          <Field label="States of interest">
            <MultiSelect options={STATES} value={student.preferredStates || []}
              onChange={v => setField("preferredStates", v)} placeholder="Pick one or more…"/>
          </Field>
        </div>
      </div>

      <div className="panel sunken">
        <div className="grid cols-3" style={{gap: 24}}>
          <div>
            <div className="eyebrow mb-2" style={{color:"var(--tier-safe)"}}>Strong effect — modelled</div>
            <p className="footnote">Rank · category · PwBD · quota · in-service · specialty · round · domicile.</p>
          </div>
          <div>
            <div className="eyebrow mb-2" style={{color:"var(--brand-orange)"}}>Niche — flag only</div>
            <p className="footnote">Religion (minority institutions e.g. CMC Vellore, AMU). No multiplier.</p>
          </div>
          <div>
            <div className="eyebrow mb-2" style={{color:"var(--ink-muted)"}}>No effect — excluded</div>
            <p className="footnote">Gender · age · MBBS college of origin.</p>
          </div>
        </div>
      </div>

      {onContinue && (
        <div className="profile-cta">
          <div className="profile-cta-text">
            {complete
              ? <span style={{color:"var(--tier-safe)", fontWeight:600}}>✓ Profile complete — you're ready.</span>
              : <span>Fill the required fields to continue: <strong>{missing.map(f => f.label).join(", ")}</strong></span>}
          </div>
          <button className="btn primary" disabled={!complete}
                  onClick={() => complete && onContinue()}>
            Continue to predictions →
          </button>
        </div>
      )}
    </div>
  );
}

function MultiSelect({ options, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = (o) => onChange(value.includes(o) ? value.filter(x => x !== o) : [...value, o]);
  return (
    <div ref={ref} className={"multiselect" + (open ? " open" : "")}>
      <div className="multiselect-trigger" role="button" tabIndex={0}
           onClick={() => setOpen(o => !o)}
           onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}>
        {value.length === 0 && <span className="placeholder">{placeholder}</span>}
        {value.map(v => (
          <span key={v} className="chip purple" style={{fontSize: 11}} onClick={e => { e.stopPropagation(); toggle(v); }}>
            {v} <span className="x">✕</span>
          </span>
        ))}
      </div>
      {open && (
        <div className="multiselect-panel">
          {options.length === 0 && <div className="multiselect-empty">No options available.</div>}
          {options.map(o => {
            const isSelected = value.includes(o);
            return (
              <div key={o} className={"multiselect-option" + (isSelected ? " selected" : "")} onClick={() => toggle(o)}>
                <span className="tick">{isSelected ? "✓" : ""}</span>
                <span>{o}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CollegesTab({ records }) {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const colleges = COLLEGES;
  const dataByCollege = useMemo(() => {
    const map = new Map();
    for (const r of records) {
      if (!map.has(r.college)) map.set(r.college, { years: new Set(), courses: new Set() });
      const e = map.get(r.college); e.years.add(r.year); e.courses.add(r.course);
    }
    return map;
  }, [records]);

  const filtered = useMemo(() => {
    let list = colleges.filter(c => collegeMatchesQuery(c, query));
    if (stateFilter !== "All") list = list.filter(c => c.state === stateFilter);
    if (typeFilter !== "All") list = list.filter(c => c.type === typeFilter);
    return list;
  }, [colleges, query, stateFilter, typeFilter]);

  const pager = usePagination(filtered, 25);

  return (
    <div>
      <div className="mb-6">
        <h3 className="h3" style={{margin:0}}>NMC PG master list</h3>
        <p className="subtitle" style={{margin:"6px 0 0", fontSize:14}}>{colleges.length.toLocaleString("en-IN")} colleges bundled. Search across canonical name and aliases. Data-availability shows what each row knows about.</p>
      </div>

      <div className="grid cols-3 mb-4" style={{gap: 12}}>
        <Field label="Search">
          <input type="text" className="input" placeholder="Name, alias, city…" value={query} onChange={e => setQuery(e.target.value)} />
        </Field>
        <Field label="State">
          <Select value={stateFilter} options={["All", ...STATES]} onChange={setStateFilter} />
        </Field>
        <Field label="Type">
          <Select value={typeFilter} options={["All", ...COLLEGE_TYPES]} onChange={setTypeFilter} />
        </Field>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>College</th><th>State · City</th><th>Type</th><th className="num">Seats</th><th>Data</th>
            </tr>
          </thead>
          <tbody>
            {pager.slice.length === 0 && (
              <tr><td colSpan="5" style={{textAlign:"center", color:"var(--ink-faint)", padding:"36px"}}>No colleges match these filters.</td></tr>
            )}
            {pager.slice.map(c => {
              const av = dataByCollege.get(c.name);
              const hasData = av && av.years.size > 0;
              return (
                <tr key={c.id}>
                  <td className="col-name">
                    <div>{c.name}</div>
                    {c.aliases && c.aliases.length > 0 && (
                      <div className="footnote mono" style={{marginTop:2, fontSize: 10}}>{c.aliases.join(" · ")}</div>
                    )}
                  </td>
                  <td className="muted">{c.state} <span style={{color:"var(--ink-faint)"}}>· {c.city}</span></td>
                  <td><span className="chip">{c.type}</span></td>
                  <td className="num">{c.totalPgSeats || "—"}</td>
                  <td>{hasData
                    ? <span className="num mono" style={{fontSize:12}}>{av.years.size}y · {av.courses.size}c</span>
                    : <span className="footnote">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination pager={pager} label="colleges" />
    </div>
  );
}
