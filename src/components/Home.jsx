/* Home — single-page entry flow. Inputs at top, results below.
   No tab-hopping required to see predictions. */
import React, { useMemo } from "react";
import { STATES } from "../lib/colleges.js";
import {
  Field, TierBadge, TierStrip, tierColor, fmtRank,
} from "./ui.jsx";

export function Home({
  predictions, student, setStudent, hasData, analysisYear,
  onOpenDeepDive, onRoute,
}) {
  const setField = (k, v) => setStudent(s => ({ ...s, [k]: v }));
  const ready = hasData && student.neetPgRank > 0;
  const firstName = (student.name || "").trim().split(/\s+/)[0];

  const tierCounts = useMemo(() => {
    const c = { Safe: 0, Likely: 0, Target: 0, Reach: 0, Unlikely: 0 };
    for (const p of predictions) c[p.tier] = (c[p.tier] || 0) + 1;
    return c;
  }, [predictions]);

  const topPicks = useMemo(
    () => [...predictions].sort((a, b) => b.P - a.P).slice(0, 12),
    [predictions]
  );

  return (
    <section className="hero" id="hero">
      <span className="blob tr" />
      <span className="blob bl" />
      <span className="blob halo" />

      <div className="shell hero-inner">
        <div className="hero-meta">
          <div className="left">
            <span className="pip" />
            <span>NEET PG · {analysisYear === "forecast" ? "2026 Prediction" : `${analysisYear} Backtest`}</span>
          </div>
          <div className="right">
            {ready
              ? <span>{predictions.length} predictions ready</span>
              : <span>{hasData ? "Enter your rank to begin" : "Loading data…"}</span>}
          </div>
        </div>

        {/* ====== Input panel (always visible) ====== */}
        <div className="home-form">
          <div className="brand-row"><span className="wordmark">ARDENT MDS</span></div>
          <span className="wordmark-underline" />
          {firstName && <p className="home-greeting">Welcome back, {firstName}.</p>}
          <h1 className="home-title">Where can your rank get you?</h1>
          <p className="home-sub">
            Enter your NEET PG rank — predictions update instantly across every
            college and quota you're eligible for.
          </p>
          <p className="home-scope">
            <strong>Coverage:</strong> MCC counselling only — All-India Quota,
            Deemed &amp; Central university seats. State-quota government seats
            (~50% of govt seats, filled via separate state counselling) and most
            DNB seats are not included.
          </p>

          <hr className="rule" />
          <div className="home-inputs">
            <Field label="NEET PG All India Rank *" hint="Your AIR (1 – 250,000)">
              <input
                type="number" className="input num" placeholder="e.g. 12847"
                value={student.neetPgRank || ""} min="1" max="250000" inputMode="numeric"
                autoFocus
                onChange={e => {
                  const v = e.target.value;
                  setField("neetPgRank", v === "" ? 0 : Math.max(0, parseInt(v) || 0));
                }}
              />
            </Field>
            <Field label="Category">
              <select className="select" value={student.category}
                      onChange={e => setField("category", e.target.value)}>
                {["UR", "EWS", "OBC-NCL", "SC", "ST"].map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Domicile state" hint="Unlocks state-quota pools">
              <select className="select" value={student.domicileState || ""}
                      onChange={e => setField("domicileState", e.target.value)}>
                <option value="">— None —</option>
                {STATES.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <p className="home-hint">
            Need PwBD / in-service / ESIC / AFMS toggles or specialty filters?{" "}
            <button className="link" onClick={() => onRoute("profile")}>Open full profile →</button>
          </p>
        </div>

        {/* ====== Results (auto-shows when ready) ====== */}
        {ready && (
          <div className="home-results">
            {predictions.length === 0 ? (
              <div className="home-summary" style={{textAlign: "center"}}>
                <div className="h3" style={{margin: 0}}>No predictions match your profile</div>
                <p className="footnote" style={{margin: "10px auto 0", maxWidth: 520}}>
                  None of your eligible pools intersect any (college × course) in the data
                  ({student.category}{student.domicileState ? ` · ${student.domicileState}` : ""}).
                  Try a different category, set a domicile state, or check the profile page.
                </p>
                <button className="btn primary sm" style={{marginTop: 16}} onClick={() => onRoute("profile")}>
                  Edit profile »
                </button>
              </div>
            ) : (
              <>
                <div className="home-summary">
                  <div className="home-summary-head">
                    <div>
                      <div className="eyebrow" style={{color: "var(--brand-orange)"}}>
                        {firstName ? `${firstName}'s portfolio` : "Your portfolio"} · Rank {fmtRank(student.neetPgRank)}
                      </div>
                      <div className="h3" style={{margin: "4px 0 0"}}>
                        {predictions.length.toLocaleString("en-IN")} eligible (college × course) combinations
                      </div>
                    </div>
                    <button className="btn primary sm" onClick={() => onRoute("predictions")}>
                      See all predictions »
                    </button>
                  </div>
                  <div style={{marginTop: 18}}>
                    <TierStrip tierCounts={tierCounts} total={predictions.length} />
                  </div>
                </div>

                <div className="home-top">
                  <div className="home-top-label">
                    Your top {topPicks.length} picks — sorted by probability
                  </div>
                  <div className="home-cards">
                    {topPicks.map((p, i) => (
                      <button
                        key={`${p.college}::${p.course}::${i}`}
                        className="home-card"
                        onClick={() => onOpenDeepDive(p)}
                      >
                        <div className="home-card-head">
                          <TierBadge tier={p.tier} />
                          <span className="num home-card-prob" style={{color: tierColor(p.tier)}}>
                            {Math.round(p.P * 100)}%
                          </span>
                        </div>
                        <div className="home-card-college">
                          {p.college.replace(/,?\s*\(.*\)$/, "")}
                        </div>
                        <div className="home-card-course">{p.course}</div>
                        <div className="home-card-meta">
                          <span>{p.drivingPool.label}</span>
                          <span>·</span>
                          <span>cutoff ~{fmtRank(p.drivingPool.forecast)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
