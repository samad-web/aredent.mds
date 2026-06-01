/* PredictionsDashboard, CollegeBrowser, DeepDive, Methodology, BacktestPanel, CollegeMetaModal. */
import React, { useState, useEffect, useMemo } from "react";
import {
  fmtRank, fmtPct, fmtInt, tierColor,
  TierBadge, ProbBar, Sparkline, Field, TierStrip, LineChart, HBar, Toggle,
  RiskFlags, usePagination, Pagination, PageHeader,
} from "./ui.jsx";
import {
  COLLEGES, STATES, COLLEGE_TYPES, SPECIALTIES_LIST,
  COLLEGES_DATA_VERSION, COLLEGES_LAST_UPDATED, collegeMatchesQuery,
} from "../lib/colleges.js";
import { runBacktest, normalCdf } from "../lib/algo.js";

// ============================================================
// Predictions Dashboard
// ============================================================
export function PredictionsDashboard({ records, predictions, student, stream = "PG", onOpenDeepDive, onOpenAdmin }) {
  const isMds = stream === "MDS";
  const examName = isMds ? "NEET MDS" : "NEET PG";
  const [sortKey, setSortKey] = useState("P");
  const [sortDir, setSortDir] = useState("desc");
  const [filterTier, setFilterTier] = useState("All");
  const [filterQuery, setFilterQuery] = useState("");
  const [expandedKey, setExpandedKey] = useState(null);

  const tierCounts = useMemo(() => {
    const c = { Safe:0, Likely:0, Target:0, Reach:0, Unlikely:0 };
    for (const p of predictions) c[p.tier] = (c[p.tier] || 0) + 1;
    return c;
  }, [predictions]);

  const filtered = useMemo(() => {
    let out = predictions;
    if (filterTier !== "All") out = out.filter(p => p.tier === filterTier);
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      out = out.filter(p => p.college.toLowerCase().includes(q) || p.course.toLowerCase().includes(q));
    }
    out = [...out].sort((a, b) => {
      let av, bv;
      switch (sortKey) {
        case "college": av = a.college; bv = b.college; break;
        case "course":  av = a.course;  bv = b.course;  break;
        case "P":       av = a.P;       bv = b.P;       break;
        case "tier": {
          const order = { Safe:0, Likely:1, Target:2, Reach:3, Unlikely:4 };
          av = order[a.tier]; bv = order[b.tier]; break;
        }
        case "gap":     av = a.rankGap; bv = b.rankGap; break;
        default:        av = a.P;       bv = b.P;
      }
      if (av == null) av = 0; if (bv == null) bv = 0;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return out;
  }, [predictions, sortKey, sortDir, filterTier, filterQuery]);

  const pager = usePagination(filtered, 25);

  const toggleSort = (k) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "college" || k === "course" ? "asc" : "desc"); }
  };

  const exportCsv = () => {
    const rows = [["College","Course","Quota driving","P","CI_low","CI_high","Tier","Rank gap","Trend","Volatility"]];
    for (const p of filtered) {
      rows.push([p.college, p.course, p.drivingPool.label,
        fmtPct(p.P,1).replace("%",""), fmtPct(p.ciLo,1).replace("%",""), fmtPct(p.ciHi,1).replace("%",""),
        p.tier, p.rankGap?.toFixed(0), p.trendLabel, p.volLabel ]);
    }
    const csv = rows.map(r => r.map(c => {
      const s = String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ardent_mds_predictions_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const total = predictions.length;

  if (!records.length || !student.neetPgRank) {
    return (
      <div className="page-wrap">
        <div className="shell">
          <PageHeader eyebrow="Output" title="Predictions"
            subtitle="A ranked, calibrated probability for every (college × course) combination your data covers." />
          <div className="empty">
            <div className="big">{!records.length ? "No data loaded yet" : "No rank entered"}</div>
            <p style={{maxWidth: 480, margin:"0 auto"}}>{!records.length
              ? "Sign in to the Admin panel to upload an allotment file, or load the sample dataset."
              : `Head to the Home tab and enter your ${examName} rank to see predictions.`}</p>
            <button className="btn primary sm mt-4" onClick={onOpenAdmin}>
              {!records.length ? "Open admin »" : "Go to home »"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Records + rank are present but the predictor returned nothing — none of the
  // student's eligible pools intersect any (college, course) in the data.
  // The empty filter-result message would be misleading here, so give a real diagnosis.
  if (predictions.length === 0) {
    const distinctColleges = new Set(records.map(r => r.college)).size;
    return (
      <div className="page-wrap">
        <div className="shell">
          <PageHeader eyebrow="Output" title="Predictions"
            subtitle={<span>Calibrated probability for every (college × course) combination — for a candidate at rank <strong className="num">{fmtRank(student.neetPgRank)}</strong>.</span>}
          />
          <div className="empty">
            <div className="big">No eligible pools matched your profile</div>
            <p style={{maxWidth: 560, margin: "0 auto"}}>
              You have <strong className="num">{records.length.toLocaleString("en-IN")}</strong> historical rows across <strong className="num">{distinctColleges}</strong> colleges,
              but none of them fall under a quota/category combination you're eligible for ({student.category}{student.domicileState ? ` · ${student.domicileState}` : ""}).
              Try widening your category, picking a domicile state, or uploading data that covers your eligibility.
            </p>
            <button className="btn primary sm mt-4" onClick={onOpenAdmin}>Edit profile »</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <div className="shell">
        <PageHeader eyebrow="Output" title="Predictions"
          subtitle={<span>Calibrated probability for every (college × course) combination — for a candidate at rank <strong className="num">{fmtRank(student.neetPgRank)}</strong>.</span>}
          right={<button className="btn secondary sm" onClick={exportCsv}>↓ Export CSV</button>}
        />

        <p className="scope-note mb-4">
          <strong>Scope:</strong> MCC {isMds ? "NEET-MDS (dental) " : ""}counselling seats only (All-India Quota, Deemed &amp; Central universities).
          State-quota government seats{isMds ? "" : " and most DNB seats"} go through separate counselling and are not predicted here.
          {" "}2026 is a projection from historical allotments — official {examName} 2026 results are not yet published.
        </p>

        <div className="mb-6">
          <div className="label mb-2">Portfolio composition · {total} predictions</div>
          <TierStrip tierCounts={tierCounts} total={total} />
        </div>

        <div className="spread mb-4" style={{flexWrap:"wrap", gap:12}}>
          <div className="hflex" style={{gap: 6, flexWrap:"wrap"}}>
            {["All","Safe","Likely","Target","Reach","Unlikely"].map(t => (
              <button key={t} type="button" onClick={() => setFilterTier(t)}
                className="chip" style={{
                  background: filterTier === t ? "var(--navy)" : "white",
                  color: filterTier === t ? "white" : (t === "All" ? "var(--ink)" : tierColor(t)),
                  borderColor: filterTier === t ? "var(--navy)" : "var(--rule)",
                  cursor: "pointer", fontWeight: 600
                }}>
                {t !== "All" && <span className="dot" style={{width:6, height:6, borderRadius:"50%", background: tierColor(t), display:"inline-block"}}/>}
                <span>{t}</span>
                {t !== "All" && <span className="num" style={{opacity:0.7, fontSize: 11}}>{tierCounts[t] || 0}</span>}
              </button>
            ))}
          </div>
          <input type="text" className="input" placeholder="Filter by college or course…"
            value={filterQuery} onChange={e => setFilterQuery(e.target.value)} style={{maxWidth: 320}}/>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort("college")}>College {sortKey==="college" && <span className="sort-indicator">{sortDir==="asc"?"▲":"▼"}</span>}</th>
                <th className="sortable" onClick={() => toggleSort("course")}>Course {sortKey==="course" && <span className="sort-indicator">{sortDir==="asc"?"▲":"▼"}</span>}</th>
                <th>Driving pool</th>
                <th className="num sortable" onClick={() => toggleSort("P")}>Probability {sortKey==="P" && <span className="sort-indicator">{sortDir==="asc"?"▲":"▼"}</span>}</th>
                <th className="num">CI 95%</th>
                <th className="sortable" onClick={() => toggleSort("tier")}>Tier {sortKey==="tier" && <span className="sort-indicator">{sortDir==="asc"?"▲":"▼"}</span>}</th>
                <th className="num sortable" onClick={() => toggleSort("gap")}>Rank gap {sortKey==="gap" && <span className="sort-indicator">{sortDir==="asc"?"▲":"▼"}</span>}</th>
                <th style={{width: 32}}></th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.length === 0 && (
                <tr><td colSpan="8" style={{textAlign:"center", color:"var(--ink-faint)", padding:"36px"}}>No predictions match these filters.</td></tr>
              )}
              {pager.slice.flatMap(p => {
                const key = `${p.college}::${p.course}`;
                const isOpen = expandedKey === key;
                const rows = [
                  <tr key={key} onClick={() => setExpandedKey(isOpen ? null : key)} style={{cursor:"pointer"}}>
                    <td className="col-name">{p.college}</td>
                    <td className="muted">{p.course}</td>
                    <td>
                      <div className="hflex" style={{gap: 10}}>
                        <ProbBar P={p.drivingPool.p} tier={p.tier} width={72}/>
                        <span style={{fontSize:12, color:"var(--ink-muted)"}}>{p.drivingPool.label}</span>
                      </div>
                    </td>
                    <td className="num"><strong style={{fontFamily:"var(--font-display)", fontSize:18, fontWeight: 700, color:"var(--navy)"}}>{fmtPct(p.P,0)}</strong></td>
                    <td className="num"><span className="mono" style={{color:"var(--ink-muted)", fontSize:12}}>[{fmtPct(p.ciLo,0)} – {fmtPct(p.ciHi,0)}]</span></td>
                    <td><TierBadge tier={p.tier}/></td>
                    <td className="num">{p.rankGap > 0 ? "+" : ""}{fmtInt(p.rankGap)}</td>
                    <td style={{textAlign:"right", paddingRight: 16, color:"var(--ink-faint)"}}>›</td>
                  </tr>
                ];
                if (isOpen) rows.push(
                  <tr key={key + "::exp"}>
                    <td colSpan="8" style={{padding: 0, background: "var(--bg-soft)"}}>
                      <div style={{padding:"20px 24px 24px"}}>
                        <ExpandedDetail pred={p} onOpenDeepDive={onOpenDeepDive} />
                      </div>
                    </td>
                  </tr>
                );
                return rows;
              })}
            </tbody>
          </table>
        </div>
        <Pagination pager={pager} label="predictions" />
      </div>
    </div>
  );
}

function ExpandedDetail({ pred, onOpenDeepDive }) {
  const sparkData = pred.drivingPool.yearPts.map(p => ({ x: p.year, val: p.val }));
  return (
    <div className="grid cols-3" style={{gap: 32}}>
      <div>
        <div className="label mb-2">By round (cumulative)</div>
        <div className="vflex" style={{gap:6}}>
          {[
            { k: "R1",  label: "By R1",          v: pred.pByRound.R1 },
            { k: "R3",  label: "By R3 / Mop-up", v: pred.pByRound.byR3 },
            { k: "St",  label: "By Stray",       v: pred.pByRound.byStray },
          ].map(row => (
            <div key={row.k} className="spread" style={{gap:8}}>
              <span style={{fontSize:13, color:"var(--ink-muted)"}}>{row.label}</span>
              <span className="num" style={{fontSize:14, color:"var(--ink)", fontWeight: 600}}>{fmtPct(row.v, 0)}</span>
            </div>
          ))}
        </div>
        <div className="label mb-2 mt-6">Trend (driving pool)</div>
        <div className="spread" style={{gap:8}}>
          <Sparkline data={sparkData} width={120} height={32} color={tierColor(pred.tier)}/>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:13, color:"var(--ink)", fontWeight: 600}}>{pred.trendLabel}</div>
            <div className="num" style={{fontSize:11, color:"var(--ink-faint)", fontFamily:"var(--font-mono)"}}>σ {fmtPct(pred.sigmaPct,0)}</div>
          </div>
        </div>
      </div>
      <div>
        <div className="label mb-2">Pool comparison</div>
        <HBar items={pred.pools.slice(0,5).map(p => ({ label: p.label, value: p.p, color: tierColor(pred.tier) }))}
              width={360} valueFmt={v => fmtPct(v, 0)} />
      </div>
      <div>
        <div className="label mb-2">Risk flags</div>
        <RiskFlags pred={pred} />
        <div className="hflex mt-4" style={{gap: 8}}>
          <button className="btn primary sm" onClick={() => onOpenDeepDive(pred)}>Open Deep Dive »</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// College Browser
// ============================================================
export function CollegeBrowser({ records, student, onPredict, onViewInfo, interested, onToggleInterested }) {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [specialtyFilter, setSpecialtyFilter] = useState("All");
  const [minorityOnly, setMinorityOnly] = useState(false);
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
    if (specialtyFilter !== "All") list = list.filter(c => (c.pgCoursesOffered || []).includes(specialtyFilter));
    if (minorityOnly) list = list.filter(c => c.isMinorityInstitution);
    return list;
  }, [colleges, query, stateFilter, typeFilter, specialtyFilter, minorityOnly]);

  const pager = usePagination(filtered, 25);

  return (
    <div className="page-wrap">
      <div className="shell">
        <PageHeader eyebrow="Reference" title="College Browser"
          subtitle={`${colleges.length.toLocaleString("en-IN")} NMC PG colleges. Search by name or alias. Predictable rows have uploaded data; the rest show metadata and peer suggestions.`}
          right={<span className="footnote mono">v{COLLEGES_DATA_VERSION} · {COLLEGES_LAST_UPDATED}</span>}
        />

        <div className="grid cols-4 mb-4" style={{gap:12}}>
          <Field label="Search">
            <input type="text" className="input" placeholder="Name, alias, city…"
                   value={query} onChange={e => setQuery(e.target.value)} />
          </Field>
          <Field label="State">
            <select className="select" value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
              <option>All</option>{STATES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className="select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option>All</option>{COLLEGE_TYPES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Specialty">
            <select className="select" value={specialtyFilter} onChange={e => setSpecialtyFilter(e.target.value)}>
              <option>All</option>{SPECIALTIES_LIST.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <div className="hflex mb-4" style={{gap:24, flexWrap:"wrap"}}>
          <Toggle checked={minorityOnly} onChange={setMinorityOnly} label="Minority institutions only" />
          <span className="footnote" style={{marginLeft:"auto"}}>{filtered.length.toLocaleString("en-IN")} colleges</span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>College</th><th>State · City</th><th>Type</th><th className="num">Seats</th>
                <th>Data availability</th><th>Notes</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.length === 0 && (
                <tr><td colSpan="7" style={{textAlign:"center", color:"var(--ink-faint)", padding:"36px"}}>No colleges match these filters.</td></tr>
              )}
              {pager.slice.map(c => {
                const av = dataByCollege.get(c.name);
                const hasData = av && av.years.size > 0;
                const minorityMatch = c.isMinorityInstitution && student?.religion && c.minorityType === student.religion;
                return (
                  <tr key={c.id}>
                    <td className="col-name">
                      <div>{c.name}</div>
                      {c.aliases && c.aliases.length > 0 && (
                        <div className="footnote mono" style={{marginTop:2, fontSize: 10}}>{c.aliases.join(" · ")}</div>
                      )}
                    </td>
                    <td className="muted">{c.state}<br/><span style={{fontSize:11, color:"var(--ink-faint)"}}>{c.city}</span></td>
                    <td>
                      <span className="chip" style={{
                        color: c.type === "Central-INI" ? "var(--brand-orange)" : "var(--ink-muted)",
                        borderColor: c.type === "Central-INI" ? "var(--brand-orange)" : "var(--rule)",
                        background: c.type === "Central-INI" ? "var(--brand-orange-soft)" : "white"
                      }}>{c.type}</span>
                    </td>
                    <td className="num">{c.totalPgSeats || "—"}</td>
                    <td>{hasData
                      ? <span className="num mono" style={{fontSize:12, color:"var(--ink)"}}>{av.years.size}y × {av.courses.size}c</span>
                      : <span className="label" style={{color: "var(--brand-orange)"}}>No uploaded data</span>}</td>
                    <td>
                      <div className="vflex" style={{gap:4}}>
                        {c.isMinorityInstitution && (
                          <span className="footnote" style={{color: minorityMatch ? "var(--purple)" : "var(--ink-faint)", fontWeight: minorityMatch ? 600 : 400}}>
                            {minorityMatch ? "✓ " : ""}{c.minorityType} minority{minorityMatch ? " — eligible" : ""}
                          </span>
                        )}
                        <span className="footnote">{(c.pgCoursesOffered || []).length} specialties</span>
                      </div>
                    </td>
                    <td style={{whiteSpace:"nowrap"}}>
                      <div className="hflex" style={{gap:6, justifyContent:"flex-end"}}>
                        <button className="btn xs ghost" onClick={() => onViewInfo(c)}>View info</button>
                        <button className="btn xs primary" disabled={!hasData} onClick={() => onPredict(c)}>
                          {hasData ? "Predict" : "—"}
                        </button>
                        <button className="btn xs ghost" onClick={() => onToggleInterested(c.id)} title={interested.has(c.id) ? "Pinned" : "Pin"}>
                          {interested.has(c.id) ? "★" : "☆"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination pager={pager} label="colleges" />
      </div>
    </div>
  );
}

// ============================================================
// Deep Dive
// ============================================================
export function DeepDive({ pred, college, student, records, onClose, allPredictions }) {
  const [shift, setShift] = useState(0);
  if (!pred) return null;

  const shiftedP = useMemo(() => {
    if (!pred.drivingPool) return null;
    let combined = 1;
    for (const pe of pred.pools) {
      const shifted = pe.forecast * (1 + shift / 100);
      const z = (shifted - student.neetPgRank) / pe.se;
      combined *= (1 - normalCdf(z));
    }
    return Math.min(0.99, Math.max(0.01, 1 - combined));
  }, [shift, pred, student]);

  const peerColleges = useMemo(() => {
    if (!allPredictions) return [];
    return allPredictions
      .filter(p => p.course === pred.course && p.college !== pred.college)
      .sort((a, b) => Math.abs(a.drivingPool.forecast - pred.drivingPool.forecast) - Math.abs(b.drivingPool.forecast - pred.drivingPool.forecast))
      .slice(0, 5);
  }, [allPredictions, pred]);

  const chartData = pred.yearByRoundChart;
  const rounds = ["R1","R2","R3","Mop-up","Stray"];
  const roundColors = {
    R1: "var(--tier-safe)", R2: "var(--tier-likely)", R3: "var(--tier-target)",
    "Mop-up": "var(--tier-reach)", Stray: "var(--brand-orange)"
  };
  const tc = tierColor(pred.tier);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200, background: "rgba(11,22,53,0.42)",
      display: "flex", justifyContent: "center", overflowY: "auto"
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "white", margin: "32px 0",
        width: "min(1080px, calc(100vw - 32px))",
        borderRadius: 18, height: "fit-content",
        boxShadow: "0 30px 80px -20px rgba(0,0,0,0.35)"
      }}>
        <div style={{
          padding: "20px 32px", borderBottom: "1px solid var(--rule)",
          position: "sticky", top: 0, background: "white", zIndex: 2, borderTopLeftRadius: 18, borderTopRightRadius: 18,
          display:"flex", justifyContent:"space-between", alignItems:"center"
        }}>
          <div>
            <div className="eyebrow" style={{color:"var(--brand-orange)"}}>Deep Dive</div>
            <div className="h4" style={{margin:"4px 0 0"}}>
              <span style={{color:"var(--navy)"}}>{pred.college}</span> · <span style={{color:"var(--purple)"}}>{pred.course}</span>
            </div>
          </div>
          <button className="btn ghost sm" onClick={onClose}>Close ✕</button>
        </div>

        <div style={{padding: "32px"}}>
          <div className="grid cols-1-2" style={{gap: 40}}>
            <aside>
              {college && (
                <div className="panel">
                  <div className="eyebrow mb-2">Institution</div>
                  <h3 className="h4" style={{margin:"0 0 12px"}}>{college.name}</h3>
                  <div className="vflex" style={{gap: 8}}>
                    <KV label="Type" value={college.type}/>
                    <KV label="Location" value={`${college.city}, ${college.state}`}/>
                    {college.established && <KV label="Established" value={college.established} mono/>}
                    {college.totalPgSeats && <KV label="Total PG seats" value={college.totalPgSeats} mono/>}
                    {college.affiliation && <KV label="Affiliation" value={college.affiliation}/>}
                    {college.isMinorityInstitution && <KV label="Minority" value={`${college.minorityType} institution`}/>}
                  </div>
                  <div className="label mt-6 mb-2">Specialties offered</div>
                  <div className="hflex" style={{flexWrap:"wrap", gap: 4}}>
                    {(college.pgCoursesOffered || []).map(s => (
                      <span key={s} className="chip" style={{fontSize: 10}}>{s.replace(/^MD |^MS /,"")}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-6">
                <div className="label mb-2">Risk flags</div>
                <RiskFlags pred={pred} />
              </div>
            </aside>

            <div>
              <div className="mb-8">
                <div className="label mb-2">Probability of admission</div>
                <div className="hflex" style={{alignItems:"baseline", gap: 24, flexWrap:"wrap"}}>
                  <span className="num" style={{fontFamily:"var(--font-display)", fontWeight:800, fontSize: 80, lineHeight: 1, color: tc, letterSpacing:"-0.03em"}}>{fmtPct(pred.P,0)}</span>
                  <div>
                    <TierBadge tier={pred.tier}/>
                    <div className="mono" style={{fontSize: 13, color:"var(--ink-muted)", marginTop: 6}}>[{fmtPct(pred.ciLo,0)} – {fmtPct(pred.ciHi,0)}] · 95% confidence</div>
                  </div>
                </div>
                <div className="label mt-3">{pred.drivingPool.label} · driving pool</div>
              </div>

              <div className="panel mb-6">
                <div className="spread mb-3">
                  <div>
                    <div className="label">Closing rank by year & round</div>
                    <p className="footnote" style={{margin: "4px 0 0"}}>95th-percentile allotted rank, driving pool group.</p>
                  </div>
                  <div className="hflex" style={{gap: 12, flexWrap:"wrap"}}>
                    {rounds.map(r => (
                      <span key={r} className="hflex" style={{gap: 4, fontSize: 11, color:"var(--ink-muted)"}}>
                        <span style={{display:"inline-block", width: 10, height: 2, background: roundColors[r]}}/>
                        <span>{r}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <LineChart data={chartData.map(d => ({ x: d.year, ...d }))}
                  series={rounds.map(r => ({ key: r, label: r, color: roundColors[r] }))}
                  height={240} invertY={false} yLabel="Closing rank"/>
                <p className="footnote mt-3" style={{textAlign:"center"}}>Lower line = tighter cutoff. Your rank: <strong className="num">{fmtRank(student.neetPgRank)}</strong>.</p>
              </div>

              <div className="panel mb-6">
                <div className="label mb-3">Per-pool probability — combined via 1 − Π(1 − p<sub>i</sub>)</div>
                <HBar items={pred.pools.map(p => ({
                  label: p.label, value: p.p,
                  color: p.p >= 0.65 ? "var(--tier-safe)" : p.p >= 0.4 ? "var(--tier-target)" : "var(--tier-reach)"
                }))} width={520} valueFmt={v => fmtPct(v, 0)} />
              </div>

              <div className="panel mb-6">
                <div className="spread mb-3">
                  <div className="label">Sensitivity</div>
                  <span className="num mono" style={{fontSize: 13, color:"var(--ink-muted)"}}>shift: {shift > 0 ? "+" : ""}{shift}%</span>
                </div>
                <p className="footnote mb-3">If next year's cutoffs shift by ±X% across all pools, the combined probability becomes:</p>
                <input type="range" className="slider" min="-50" max="50" step="1" value={shift} onChange={e => setShift(parseInt(e.target.value))}/>
                <div className="spread mt-3">
                  <span className="footnote mono">−50%</span>
                  <span className="num" style={{fontFamily:"var(--font-display)", fontWeight: 800, fontSize: 40, lineHeight: 1, color: tc, letterSpacing:"-0.02em"}}>{fmtPct(shiftedP,0)}</span>
                  <span className="footnote mono">+50%</span>
                </div>
              </div>

              {peerColleges.length > 0 && (
                <div className="panel">
                  <div className="label mb-3">Peer colleges — same specialty, similar forecast cutoff</div>
                  <div className="vflex" style={{gap: 0}}>
                    {peerColleges.map((p, i) => (
                      <div key={i} className="spread" style={{padding: "10px 0", borderBottom: i < peerColleges.length - 1 ? "1px solid var(--rule)" : "none"}}>
                        <div>
                          <div style={{fontSize:13, fontWeight: 600}}>{p.college}</div>
                          <div className="footnote mono">forecast {fmtRank(p.drivingPool.forecast)} · {p.drivingPool.label}</div>
                        </div>
                        <div className="hflex" style={{gap: 12}}>
                          <span className="num" style={{fontSize: 14, fontWeight: 600}}>{fmtPct(p.P, 0)}</span>
                          <TierBadge tier={p.tier}/>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <BacktestPanel records={records} tier={pred.tier} compact/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KV({ label, value, mono }) {
  return (
    <div className="spread" style={{gap: 8, alignItems:"baseline"}}>
      <span className="label" style={{flex: "0 0 auto"}}>{label}</span>
      <span className={mono ? "mono num" : ""} style={{fontSize: 13, textAlign:"right", color: "var(--ink)", fontWeight: 500}}>{value}</span>
    </div>
  );
}

// ============================================================
// Methodology
// ============================================================
export function Methodology({ records }) {
  return (
    <div>
      <div className="grid cols-3-2" style={{gap: 32}}>
        <div className="prose" style={{maxWidth: 640}}>
          <h4 className="h4">Step 1 · Eligible pools</h4>
          <p>A <strong>pool</strong> is a <code>(category, quota, PwBD?, in-service?)</code> filter on historical rows. UR pool is always available; reserved candidates additionally see their own category pool. State pools require domicile.</p>

          <h4 className="h4 mt-6">Step 2 · Group statistics</h4>
          <p>For every <code>(college, course, quota, pool)</code>:</p>
          <ul>
            <li><strong>Closing rank</strong>, year by year, as the <strong>95th percentile</strong> of allotted ranks — robust to outliers, unlike <code>max()</code>.</li>
            <li><strong>Trend slope</strong>: weighted least-squares, recent years weighted higher.</li>
            <li><strong>Volatility σ</strong>: standard deviation across years.</li>
            <li><strong>Thin-data flag</strong> when samples-per-year falls below three.</li>
          </ul>

          <h4 className="h4 mt-6">Step 3 · Forecast</h4>
          <p>With ≥ 2 years we extrapolate the slope, capped at <strong>±25%</strong>. With 1 year we use that year and widen σ.</p>
          <div className="eq">forecastSE = max(σ, 0.10 · forecastValue)</div>

          <h4 className="h4 mt-6">Step 4 · Probability per pool, then combine</h4>
          <div className="eq">z<sub>i</sub> = (forecastClosingRank<sub>i</sub> − R) / forecastSE<sub>i</sub><br/>p<sub>i</sub> = <strong>Φ</strong>(z<sub>i</sub>)   <span className="v">// standard-normal CDF</span></div>
          <div className="eq">P = 1 − ∏<sub>i</sub> (1 − p<sub>i</sub>)<br/>P<sub>clamped</sub> = clamp(P, 0.01, 0.99)</div>
          <p className="footnote">We deliberately do <em>not</em> use <code>max(p<sub>i</sub>)</code>, which would under-state cumulative chance.</p>

          <h4 className="h4 mt-6">Step 5 · By round</h4>
          <p>Steps 2–4 recomputed per round → <em>P(by R1)</em>, <em>P(by R3 / Mop-up)</em>, <em>P(by Stray)</em>.</p>

          <h4 className="h4 mt-6">Step 6 · Tiers</h4>
          <table className="table mono" style={{maxWidth: 360, fontSize:12, marginTop:8}}>
            <thead><tr><th>Tier</th><th className="num">Threshold on P</th></tr></thead>
            <tbody>
              {[["Safe","P ≥ 0.85"],["Likely","0.65 ≤ P < 0.85"],["Target","0.40 ≤ P < 0.65"],["Reach","0.15 ≤ P < 0.40"],["Unlikely","P < 0.15"]].map(r =>
                <tr key={r[0]}><td><TierBadge tier={r[0]}/></td><td className="num">{r[1]}</td></tr>)}
            </tbody>
          </table>

          <h4 className="h4 mt-6">Step 7 · Confidence interval</h4>
          <p>The 95% CI on <em>P</em> re-evaluates Step 4 at forecast <strong>±</strong> 1.96·SE. Widens cleanly with σ.</p>

          <h4 className="h4 mt-6">Step 8 · Honest factors</h4>
          <p><strong>Modelled:</strong> rank, category, PwBD, quota, in-service, specialty, round, domicile.</p>
          <p><strong>Flag-only:</strong> religion (minority institutions). No multiplier.</p>
          <p><strong>Excluded:</strong> gender, age, MBBS college of origin.</p>
        </div>

        <aside>
          <BacktestPanel records={records}/>
          <div className="panel sunken mt-6">
            <div className="label mb-2">Anti-promises</div>
            <ul style={{paddingLeft: 18, fontSize: 13, color:"var(--ink-muted)", margin:0, lineHeight: 1.6}}>
              <li>No fabricated probabilities. Zero data ⇒ zero number.</li>
              <li>No piecewise probability function.</li>
              <li>No max(p<sub>i</sub>). We compound.</li>
              <li>No religion multiplier.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function BacktestPanel({ records, tier, compact }) {
  const result = useMemo(() => runBacktest(records), [records]);
  if (!result) return (
    <div className="panel">
      <div className="label">Backtest calibration</div>
      <p className="footnote mt-2">Need ≥ 2 years of data to run hold-out backtest.</p>
    </div>
  );
  const tiers = compact && tier ? [tier] : ["Safe","Likely","Target","Reach","Unlikely"];
  return (
    <div className="panel">
      <div className="spread mb-3">
        <div className="label">Backtest calibration</div>
        <span className="num mono" style={{fontSize:11, color:"var(--ink-faint)"}}>holdout · {result.holdoutYear}</span>
      </div>
      <p className="footnote mb-3">Of historical {tier ? <strong>{tier}</strong> : "tier"} predictions in the held-out year, what fraction got allotted?</p>
      <div className="vflex" style={{gap: 12}}>
        {tiers.map(t => {
          const r = result.perTier[t];
          if (!r || r.total === 0) return (
            <div key={t} className="spread"><TierBadge tier={t}/><span className="footnote mono">— · n=0</span></div>
          );
          return (
            <div key={t} className="spread">
              <TierBadge tier={t}/>
              <div className="hflex" style={{gap: 14}}>
                <div className="pbar" style={{width: 100, "--tc": tierColor(t)}}>
                  <div className="fill" style={{width: `${(r.rate*100).toFixed(0)}%`}}/>
                </div>
                <span className="num" style={{fontSize: 13, fontWeight: 600, minWidth: 42, textAlign:"right"}}>{fmtPct(r.rate, 0)}</span>
                <span className="footnote mono" style={{minWidth: 48, textAlign:"right"}}>n={r.total}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// College metadata modal (no-data path)
// ============================================================
export function CollegeMetaModal({ college, student, records, predictions, onClose }) {
  const peers = useMemo(() => {
    const candidates = COLLEGES.filter(c => c.id !== college.id && c.state === college.state && c.type === college.type);
    const haveData = candidates.filter(c => predictions.some(p => p.college === c.name));
    haveData.sort((a, b) => Math.abs((a.totalPgSeats || 0) - (college.totalPgSeats || 0)) - Math.abs((b.totalPgSeats || 0) - (college.totalPgSeats || 0)));
    return haveData.slice(0, 5).map(c => {
      const preds = predictions.filter(p => p.college === c.name).sort((a, b) => b.P - a.P);
      return { college: c, top: preds[0] };
    });
  }, [college, predictions]);

  const minorityMatch = college.isMinorityInstitution && student?.religion && college.minorityType === student.religion;
  const hasAny = predictions.some(p => p.college === college.name);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(11,22,53,0.42)", display:"flex", justifyContent:"center", alignItems:"flex-start", overflowY:"auto" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{background: "white", margin: "32px 0", width: "min(780px, calc(100vw - 32px))", borderRadius: 18, boxShadow: "0 30px 80px -20px rgba(0,0,0,0.35)"}}>
        <div style={{padding: "20px 32px", borderBottom: "1px solid var(--rule)", display:"flex", justifyContent:"space-between", alignItems:"center", borderTopLeftRadius: 18, borderTopRightRadius: 18}}>
          <div>
            <div className="eyebrow" style={{color:"var(--brand-orange)"}}>Institution profile</div>
            <div className="h4" style={{margin:"4px 0 0", color:"var(--navy)"}}>{college.name}</div>
          </div>
          <button className="btn ghost sm" onClick={onClose}>Close ✕</button>
        </div>
        <div style={{padding: 32}}>
          <div className="grid cols-2 mb-6">
            <div className="vflex" style={{gap: 8}}>
              <KV label="Type" value={college.type}/>
              <KV label="Location" value={`${college.city}, ${college.state}`}/>
              {college.established && <KV label="Established" value={college.established} mono/>}
              {college.totalPgSeats && <KV label="Total PG seats" value={college.totalPgSeats} mono/>}
              {college.affiliation && <KV label="Affiliation" value={college.affiliation}/>}
            </div>
            <div>
              <div className="label mb-2">Specialties offered</div>
              <div className="hflex" style={{flexWrap:"wrap", gap: 4}}>
                {(college.pgCoursesOffered || []).map(s => <span key={s} className="chip" style={{fontSize: 10}}>{s}</span>)}
              </div>
            </div>
          </div>
          {minorityMatch && (
            <div className="panel" style={{borderColor: "var(--purple)", borderLeftWidth: 4, marginBottom: 24, background: "var(--purple-soft)"}}>
              <div className="label" style={{color: "var(--purple)"}}>Minority quota eligible</div>
              <p style={{margin: "6px 0 0", fontSize: 14, color: "var(--ink)"}}>This is a <strong>{college.minorityType}</strong> minority institution. As a {student.religion} candidate, you are eligible for its minority quota in addition to general pools. <em>This eligibility is a flag — it does not modify your probability.</em></p>
            </div>
          )}
          {!hasAny && (
            <div className="panel sunken">
              <div className="label mb-2">No historical allotment data uploaded</div>
              <p style={{margin: 0, fontSize: 14, color:"var(--ink-muted)"}}>
                We refuse to fabricate a probability. Upload more data covering this college to enable a prediction. In the meantime, peer institutions — same state, same type, comparable seat count — that <em>do</em> have data:
              </p>
              {peers.length > 0 && (
                <div className="table-wrap mt-4" style={{background: "white"}}>
                  <table className="table">
                    <thead><tr><th>Peer college</th><th>Top specialty</th><th className="num">P</th><th>Tier</th></tr></thead>
                    <tbody>
                      {peers.map(p => (
                        <tr key={p.college.id}>
                          <td className="col-name">{p.college.name}</td>
                          <td className="muted">{p.top.course}</td>
                          <td className="num">{fmtPct(p.top.P,0)}</td>
                          <td><TierBadge tier={p.top.tier}/></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
