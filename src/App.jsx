/* App — multi-route shell. Routes: home, profile, colleges, predictions.
   Admin lives as a slide-over modal, accessible from any route. */
import React, { useState, useEffect, useMemo } from "react";
import { TopNav, MobileTabs } from "./components/ui.jsx";
import { YearBar } from "./components/YearBar.jsx";
import { Home } from "./components/Home.jsx";
import {
  PredictionsDashboard, CollegeBrowser, DeepDive, CollegeMetaModal, Methodology,
} from "./components/Sections.jsx";
import { PageHeader } from "./components/ui.jsx";
import { AdminPanel, ProfileTab } from "./components/Admin.jsx";
import { COLLEGES, COLLEGES_DATA_VERSION, COLLEGES_LAST_UPDATED } from "./lib/colleges.js";
import { predictAll } from "./lib/algo.js";
import { generateSampleData } from "./lib/sampleData.js";
import { usePersistentState, hasPersistedValue } from "./lib/persist.js";
import { isSupabaseConfigured, fetchAllotmentRecords } from "./lib/supabase.js";

function Footer() {
  return (
    <footer className="site">
      <div className="shell" style={{display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap: 16}}>
        <div className="left">
          Developed by <a href="#" onClick={e => e.preventDefault()}>sirah digital</a>
        </div>
        <div className="hflex" style={{gap: 24, flexWrap:"wrap", color:"var(--ink-faint)", fontSize: 12}}>
          <span>NMC PG master list v{COLLEGES_DATA_VERSION} · updated {COLLEGES_LAST_UPDATED}</span>
          <span>Vite fullstack · API-backed</span>
        </div>
      </div>
    </footer>
  );
}

const VALID_ROUTES = ["home", "profile", "colleges", "predictions", "methodology"];

const DEFAULT_STUDENT = {
  neetPgRank: 0, category: "UR", domicileState: "",
  isPwBD: false, isInService: false,
  isESICBeneficiary: false, isAFMSCandidate: false,
  religion: "",
  preferredSpecialties: [], preferredStates: [],
};

export default function App() {
  const [records, setRecords] = usePersistentState("records", []);
  const [student, setStudent] = usePersistentState("student", DEFAULT_STUDENT);
  const [interested, setInterested] = usePersistentState(
    "interested",
    () => new Set(),
    { serialize: (v) => [...v], deserialize: (v) => new Set(v) }
  );
  const [deepDive, setDeepDive] = useState(null);
  const [adminOpen, setAdminOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return (window.location.hash || "").replace("#", "") === "admin";
  });
  const [adminTab, setAdminTab] = useState("data");
  const [loading, setLoading] = useState(false);
  const [bootError, setBootError] = useState(null);

  // "forecast" = use all history to predict next cycle.
  // <number> = predict that historical year using only records from earlier years
  //            (time-machine — useful for calibrating accuracy against truth).
  const [analysisYear, setAnalysisYear] = usePersistentState("analysisYear", "forecast");

  // The hash is the single source of truth for navigation. Two flavors:
  //   #<route>  — one of VALID_ROUTES, sets the current page
  //   #admin    — overlays the admin panel on top of the current route
  const readHash = () => (window.location.hash || "").replace("#", "");
  const [route, setRoute] = useState(() => {
    const h = readHash();
    return VALID_ROUTES.includes(h) ? h : "home";
  });

  useEffect(() => {
    // Only sync route → hash when the admin overlay isn't holding the hash.
    if (adminOpen) return;
    if (window.location.hash !== "#" + route) {
      window.history.replaceState(null, "", "#" + route);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      if (h === "admin") {
        setAdminOpen(true);
      } else {
        setAdminOpen(false);
        if (VALID_ROUTES.includes(h)) setRoute(h);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Bootstrap demo data on first paint only if the user hasn't loaded anything yet.
  // Respect persisted records/profile across refreshes.
  useEffect(() => {
    if (records.length > 0) return; // user already has data
    const hadProfile = hasPersistedValue("student");
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        if (isSupabaseConfigured) {
          // Client-direct: paginate the allotment table straight from Supabase.
          const recs = await fetchAllotmentRecords();
          if (cancelled) return;
          if (recs.length > 0) {
            setRecords(recs);
            setBootError(`Loaded ${recs.length.toLocaleString("en-IN")} allotment rows from Supabase.`);
          } else {
            setRecords(generateSampleData());
          }
        } else {
          // Fallback: server-mediated /api/records (MCC cache or synthetic sample).
          const res = await fetch("/api/records");
          if (!res.ok) throw new Error(`API ${res.status}`);
          const json = await res.json();
          if (cancelled) return;
          if (Array.isArray(json.records) && json.records.length > 0) {
            setRecords(json.records);
            if (json.source === "mcc") {
              setBootError(`Loaded ${json.count.toLocaleString("en-IN")} real allotment rows from MCC.`);
            }
          } else {
            setRecords(generateSampleData());
          }
        }
      } catch (err) {
        if (cancelled) return;
        setBootError(`Data source unreachable — using local sample data. (${err.message})`);
        setRecords(generateSampleData());
      } finally {
        if (!cancelled) setLoading(false);
      }
      // Only seed a demo rank if the user has no saved profile yet.
      if (!cancelled && !hadProfile) {
        setStudent(s => ({ ...s, neetPgRank: 8500, domicileState: "Maharashtra" }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigating to the admin hash is what opens the panel — pushState so the
  // user can use the browser back button to dismiss it.
  const openAdmin = (tab) => {
    if (tab) setAdminTab(tab);
    if (window.location.hash !== "#admin") {
      window.history.pushState(null, "", "#admin");
    }
    setAdminOpen(true);
  };
  const closeAdmin = () => {
    setAdminOpen(false);
    if (readHash() === "admin") {
      // Restore the underlying page route in the URL bar.
      window.history.pushState(null, "", "#" + route);
    }
  };

  // Years present in the data, sorted ascending.
  const availableYears = useMemo(() => {
    const ys = new Set();
    for (const r of records) ys.add(r.year);
    return [...ys].sort((a, b) => a - b);
  }, [records]);

  // Apply the analysis-year filter:
  //   "forecast" → all records (extrapolate forward)
  //   <year>     → train on records strictly before that year
  const filteredRecords = useMemo(() => {
    if (analysisYear === "forecast") return records;
    const yN = parseInt(analysisYear, 10);
    if (!Number.isFinite(yN)) return records;
    return records.filter(r => r.year < yN);
  }, [records, analysisYear]);

  // Predictions are a function of the *modeled* student fields only.
  const modeledSig = [
    student.neetPgRank, student.category, student.domicileState,
    student.isPwBD, student.isInService, student.isESICBeneficiary, student.isAFMSCandidate,
  ].join("|");
  const predictions = useMemo(() => {
    if (!filteredRecords.length || !student.neetPgRank) return [];
    return predictAll(student, filteredRecords);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRecords, modeledSig]);

  const onOpenDeepDive = (pred) => {
    const college = COLLEGES.find(c => c.name === pred.college);
    setDeepDive({ pred, college });
  };
  const onPredictCollege = (college) => {
    if (!records.length) { openAdmin("data"); return; }
    if (!student.neetPgRank) { setRoute("home"); return; }
    const preds = predictions.filter(p => p.college === college.name);
    if (!preds.length) { setDeepDive({ pred: null, college }); return; }
    preds.sort((a, b) => b.P - a.P);
    setDeepDive({ pred: preds[0], college });
  };
  const onViewInfo = (college) => setDeepDive({ pred: null, college });
  const onToggleInterested = (id) => {
    setInterested(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  return (
    <>
      <TopNav route={route} onRoute={setRoute} />
      {availableYears.length > 0 && (
        <YearBar
          analysisYear={analysisYear}
          onYearChange={setAnalysisYear}
          records={records}
          availableYears={availableYears}
        />
      )}

      {bootError && (
        <div className="shell" style={{padding: "10px 32px", marginTop: 12}}>
          <div className="panel" style={{
            background: "var(--brand-orange-soft)", borderColor: "var(--brand-orange-tint)",
            color: "var(--brand-orange-deep)", display:"flex", justifyContent:"space-between",
            alignItems:"center", gap: 12, padding: "10px 14px"
          }}>
            <span style={{fontSize: 13, fontWeight: 500}}>{bootError}</span>
            <button className="btn ghost sm" onClick={() => setBootError(null)} style={{color:"var(--brand-orange-deep)"}}>Dismiss ✕</button>
          </div>
        </div>
      )}

      {route === "home" && (
        <Home
          predictions={predictions}
          student={student}
          setStudent={setStudent}
          hasData={filteredRecords.length > 0}
          analysisYear={analysisYear}
          onOpenDeepDive={onOpenDeepDive}
          onRoute={setRoute}
        />
      )}

      {route === "predictions" && (
        <PredictionsDashboard
          records={filteredRecords}
          predictions={predictions}
          student={student}
          onOpenDeepDive={onOpenDeepDive}
          onOpenAdmin={() => {
            if (!records.length) openAdmin("data");
            else setRoute("home");
          }}
        />
      )}

      {route === "colleges" && (
        <CollegeBrowser
          records={filteredRecords}
          student={student}
          onPredict={onPredictCollege}
          onViewInfo={onViewInfo}
          interested={interested}
          onToggleInterested={onToggleInterested}
        />
      )}

      {route === "profile" && (
        <div className="page-wrap">
          <div className="shell">
            <div className="eyebrow" style={{color:"var(--brand-orange)", marginBottom: 6}}>Candidate</div>
            <ProfileTab student={student} setStudent={setStudent} />
          </div>
        </div>
      )}

      {route === "methodology" && (
        <div className="page-wrap">
          <div className="shell">
            <PageHeader eyebrow="Reference" title="Methodology"
              subtitle="The model laid bare — every step from raw allotment data to calibrated probability." />
            <Methodology records={filteredRecords} />
          </div>
        </div>
      )}

      <Footer />

      <MobileTabs route={route} onRoute={setRoute} />

      <AdminPanel
        open={adminOpen}
        onClose={closeAdmin}
        records={records}
        setRecords={setRecords}
        student={student}
        setStudent={setStudent}
        initialTab={adminTab}
      />

      {deepDive && deepDive.pred && (
        <DeepDive pred={deepDive.pred} college={deepDive.college} student={student} records={records}
          onClose={() => setDeepDive(null)} allPredictions={predictions} />
      )}
      {deepDive && !deepDive.pred && deepDive.college && (
        <CollegeMetaModal college={deepDive.college} student={student} records={records} predictions={predictions}
          onClose={() => setDeepDive(null)} />
      )}
    </>
  );
}
