/* UI primitives — Inter / orange / clean. Ported from ui.jsx. */
import React, { useState, useEffect, useMemo, useRef } from "react";

/* Single-value dropdown — visually identical to the multi-select used for
   specialties/states. Replaces native <select className="select">, whose
   open option list is drawn by the OS (Segoe UI on Windows, square corners,
   blue highlight) and can't be styled. Options accept plain strings or
   {value, label} objects. */
export function Select({ value, options, onChange, placeholder = "— Select —", className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const opts = (options || []).map(o => typeof o === "object" && o !== null ? o : { value: o, label: o });
  const selected = opts.find(o => String(o.value) === String(value));
  return (
    <div ref={ref} className={"multiselect" + (open ? " open" : "") + (className ? " " + className : "")}>
      <div className="multiselect-trigger" role="button" tabIndex={0}
           onClick={() => setOpen(o => !o)}
           onKeyDown={e => {
             if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); }
             else if (e.key === "Escape") setOpen(false);
           }}>
        {selected ? <span>{selected.label}</span> : <span className="placeholder">{placeholder}</span>}
      </div>
      {open && (
        <div className="multiselect-panel">
          {opts.length === 0 && <div className="multiselect-empty">No options available.</div>}
          {opts.map(o => {
            const isSelected = String(o.value) === String(value);
            return (
              <div key={String(o.value)}
                   className={"multiselect-option" + (isSelected ? " selected" : "")}
                   onClick={() => { onChange(o.value); setOpen(false); }}>
                <span className="tick">{isSelected ? "✓" : ""}</span>
                <span>{o.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Numeric formatting -------------------------------------------
export const fmtRank = (n) => (n == null || isNaN(n)) ? "—" : Math.round(n).toLocaleString("en-IN");
export const fmtPct  = (p, digits = 0) => (p == null || isNaN(p)) ? "—" : (p * 100).toFixed(digits) + "%";
export const fmtInt  = (n) => n == null ? "—" : Math.round(n).toLocaleString("en-IN");

// ---------- SectionHead ---------------------------------------------------
export function SectionHead({ eyebrow, title, subtitle, right }) {
  return (
    <header className="sec-head">
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-end", gap: 24, flexWrap:"wrap"}}>
        <div style={{flex:1, minWidth: 240}}>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2 className="h2" style={{margin:0}}>{title}</h2>
          {subtitle && <p className="subtitle" style={{margin: "10px 0 0"}}>{subtitle}</p>}
        </div>
        {right && <div style={{flexShrink:0}}>{right}</div>}
      </div>
    </header>
  );
}

// ---------- Tier badge ----------------------------------------------------
export function TierBadge({ tier }) {
  if (!tier) return null;
  const cls = tier.toLowerCase();
  return (
    <span className={`tier ${cls}`}>
      <span className="dot" />
      <span>{tier}</span>
    </span>
  );
}

export const tierColor = (tier) => {
  switch (tier) {
    case "Safe": return "var(--tier-safe)";
    case "Likely": return "var(--tier-likely)";
    case "Target": return "var(--tier-target)";
    case "Reach": return "var(--tier-reach)";
    case "Unlikely": return "var(--tier-unlikely)";
    default: return "var(--ink)";
  }
};

// ---------- Probability bar ----------------------------------------------
export function ProbBar({ P, tier, width = 120 }) {
  const tc = tierColor(tier);
  return (
    <div style={{position:"relative", width, height: 6}}>
      <div className="pbar" style={{position:"absolute", inset: 0, "--tc": tc}}>
        <div className="fill" style={{width: `${(P*100).toFixed(1)}%`}} />
      </div>
    </div>
  );
}

// ---------- Sparkline ----------------------------------------------------
export function Sparkline({ data, width = 120, height = 32, color = "var(--ink)" }) {
  if (!data || data.length < 2) return <svg width={width} height={height}/>;
  const vals = data.map(d => d.val);
  const min = Math.min(...vals), max = Math.max(...vals);
  const xs = data.map((d, i) => (i / (data.length - 1)) * (width - 4) + 2);
  const ys = data.map(d => {
    const t = max === min ? 0.5 : (d.val - min) / (max - min);
    return 2 + (1 - t) * (height - 4);
  });
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  return (
    <svg className="spark num" width={width} height={height} aria-hidden="true">
      <path d={path} stroke={color} strokeWidth="1.5" fill="none" />
      {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="2" fill={color}/>)}
    </svg>
  );
}

// ---------- KPI tile ------------------------------------------------------
export function Kpi({ label, value, sub, mono }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={mono ? "val mono num" : "val num"}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

// ---------- Tooltip -------------------------------------------------------
export function Tip({ children, text }) {
  return (
    <span className="tip">
      {children}
      <span className="tip-pop">{text}</span>
    </span>
  );
}

// ---------- Field ---------------------------------------------------------
export function Field({ label, hint, error, children }) {
  return (
    <label className={`field${error ? " has-error" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {(error || hint) && (
        <span className={`field-hint${error ? " error" : ""}`}>{error || hint}</span>
      )}
    </label>
  );
}

// ---------- Tier composition strip ---------------------------------------
export function TierStrip({ tierCounts, total }) {
  const tiers = ["Safe", "Likely", "Target", "Reach", "Unlikely"];
  return (
    <div className="tier-strip">
      {tiers.map(t => {
        const n = tierCounts[t] || 0;
        if (n === 0) return null;
        const pct = total ? (n / total) * 100 : 0;
        return (
          <div key={t} className="seg" style={{ flex: `${n} 0 auto`, background: tierColor(t), padding: "0 10px" }}>
            {pct > 10 ? <span className="num">{t} · {n}</span> : <span className="num">{n}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ---------- LineChart ---------------------------------------------------
export function LineChart({ data, series, width = 520, height = 260, yLabel, invertY = true }) {
  const pad = { t: 16, r: 24, b: 32, l: 56 };
  const W = width, H = height;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const allYs = [];
  for (const d of data) for (const s of series) {
    const v = d[s.key]; if (v != null && !isNaN(v)) allYs.push(v);
  }
  if (!allYs.length) return <svg width={W} height={H}/>;
  const yMin = Math.min(...allYs);
  const yMax = Math.max(...allYs);
  const yPad = (yMax - yMin) * 0.1 || 1;
  const y0 = Math.max(0, yMin - yPad);
  const y1 = yMax + yPad;
  const ySc = v => {
    const t = (v - y0) / (y1 - y0);
    return pad.t + (invertY ? t * innerH : (1 - t) * innerH);
  };
  const xs = data.map(d => d.x);
  const xSc = i => pad.l + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const gridLines = [0, 1, 2, 3, 4].map(i => {
    const v = y0 + (i / 4) * (y1 - y0);
    return { v, y: ySc(v) };
  });

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={pad.l} y1={g.y} x2={W - pad.r} y2={g.y} stroke="var(--rule)" strokeWidth="1" strokeDasharray="2 4"/>
          <text x={pad.l - 8} y={g.y + 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--ink-faint)"
                style={{fontVariantNumeric:"tabular-nums lining-nums"}}>{fmtInt(g.v)}</text>
        </g>
      ))}
      {xs.map((x, i) => (
        <text key={i} x={xSc(i)} y={H - pad.b + 18} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--ink-faint)"
              style={{fontVariantNumeric:"tabular-nums lining-nums"}}>{x}</text>
      ))}
      {series.map(s => {
        const pts = data.map(d => ({ y: d[s.key] == null ? null : ySc(d[s.key]) }));
        let pathSegments = ""; let lastValid = false;
        pts.forEach((p, i) => {
          if (p.y == null) { lastValid = false; return; }
          const x = xSc(i);
          pathSegments += `${lastValid ? "L" : "M"}${x.toFixed(1)},${p.y.toFixed(1)} `;
          lastValid = true;
        });
        return (
          <g key={s.key}>
            <path d={pathSegments} fill="none" stroke={s.color || "var(--ink)"} strokeWidth="1.75"/>
            {pts.map((p, i) => p.y != null ? <circle key={i} cx={xSc(i)} cy={p.y} r="3" fill={s.color || "var(--ink)"}/> : null)}
          </g>
        );
      })}
      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="var(--ink)" strokeWidth="1"/>
      {yLabel && <text x={14} y={pad.t - 2} fontFamily="var(--font-body)" fontSize="10" fill="var(--ink-faint)"
              style={{letterSpacing:"0.08em", textTransform:"uppercase", fontWeight: 600}}>{yLabel}</text>}
    </svg>
  );
}

// ---------- Horizontal bar chart -----------------------------------------
export function HBar({ items, width = 320, height, valueFmt }) {
  const max = Math.max(...items.map(i => i.value), 0.0001);
  const rowH = 30;
  const H = height || items.length * rowH + 12;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} preserveAspectRatio="xMinYMid meet">
      {items.map((it, i) => {
        const w = (it.value / max) * (width - 200);
        const y = 6 + i * rowH;
        return (
          <g key={i}>
            <text x={0} y={y + 16} fontSize="12" fill="var(--ink)" fontFamily="var(--font-body)" fontWeight="500">{it.label}</text>
            <rect x={150} y={y + 5} width={w} height={14} fill={it.color || "var(--ink)"} rx="2"/>
            <text x={150 + w + 8} y={y + 16} fontSize="11" fill="var(--ink-muted)" fontFamily="var(--font-mono)" fontWeight="600"
                  style={{fontVariantNumeric:"tabular-nums lining-nums"}}>
              {valueFmt ? valueFmt(it.value) : it.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------- Toggle --------------------------------------------------------
export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="switch" />
      {label && <span className="text">{label}</span>}
    </label>
  );
}

// ---------- Segment control ----------------------------------------------
export function Segment({ options, value, onChange }) {
  return (
    <div className="segment">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
                className={value === o.value ? "active" : ""}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Top nav -------------------------------------------------------
// Admin is intentionally NOT in the nav — it's reached by navigating to /#admin.
export function StreamToggle({ stream, onStream }) {
  const opts = [
    { k: "MDS", label: "MDS" },
    { k: "PG", label: "NEET PG" },
  ];
  return (
    <div className="stream-toggle" role="group" aria-label="Counselling stream">
      {opts.map(o => (
        <button
          key={o.k}
          className={`stream-opt ${stream === o.k ? "active" : ""}`}
          onClick={() => onStream(o.k)}
          aria-pressed={stream === o.k}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TopNav({ route, onRoute, stream, onStream }) {
  const items = [
    { k: "home",        label: "Home" },
    { k: "profile",     label: "Profile" },
    { k: "colleges",    label: "Colleges" },
    { k: "predictions", label: "Predictions" },
    { k: "methodology", label: "Methodology" },
  ];
  return (
    <nav className="topnav">
      <div className="shell topnav-inner">
        <div className="topnav-brand" onClick={() => onRoute("home")}>
          <img className="brandmark" src="/logo.jpg" alt="Ardent" />
          <span className="brandname"><em>Ardent</em></span>
        </div>
        <div className="topnav-links">
          {items.map(s => (
            <a key={s.k} className={`topnav-link ${route === s.k ? "active" : ""}`}
               onClick={(e) => { e.preventDefault(); onRoute(s.k); }}
               href={`#${s.k}`}>
              {s.label}
            </a>
          ))}
        </div>
        {onStream && <StreamToggle stream={stream} onStream={onStream} />}
      </div>
    </nav>
  );
}

// ---------- Risk flags ----------------------------------------------------
export function RiskFlags({ pred }) {
  const flags = [];
  if (pred.thinData) flags.push({ label: "Thin data", detail: `Only ${pred.samplesTotal} samples across ${pred.yearCount} year${pred.yearCount === 1 ? "" : "s"}` });
  if (pred.volLabel === "High") flags.push({ label: "High volatility", detail: `σ ≈ ${(pred.sigmaPct * 100).toFixed(0)}% of forecast` });
  if (pred.yearCount === 1) flags.push({ label: "Cold start", detail: "Single year of data — CI widened" });
  if (!flags.length) return <span className="footnote">No risk flags.</span>;
  return (
    <div className="vflex" style={{gap: 10}}>
      {flags.map((f, i) => (
        <div key={i} style={{display:"flex", gap:12, alignItems:"flex-start"}}>
          <span style={{display:"inline-block", marginTop: 6, width: 7, height: 7, borderRadius: "50%", background: "var(--brand-orange)"}}/>
          <div>
            <div style={{fontSize:12, fontWeight:700, color:"var(--ink)", textTransform:"uppercase", letterSpacing:"0.06em"}}>{f.label}</div>
            <div className="footnote" style={{marginTop:2}}>{f.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Pagination ----------------------------------------------------
export function usePagination(items, defaultPageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  useEffect(() => { setPage(1); }, [items.length, pageSize]);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const from = (safePage - 1) * pageSize;
  const to = Math.min(from + pageSize, total);
  const slice = items.slice(from, to);
  return { page: safePage, setPage, pageSize, setPageSize, pageCount, from, to, total, slice };
}

export function Pagination({ pager, sizes = [10, 25, 50, 100], label = "rows" }) {
  const { page, setPage, pageSize, setPageSize, pageCount, from, to, total } = pager;
  if (total === 0) return null;

  const set = new Set();
  const add = (n) => { if (n >= 1 && n <= pageCount) set.add(n); };
  add(1); add(pageCount);
  for (let d = -2; d <= 2; d++) add(page + d);
  const sorted = [...set].sort((a, b) => a - b);
  const withEllipses = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) withEllipses.push("…");
    withEllipses.push(sorted[i]);
  }

  return (
    <div className="pagination">
      <div className="info">
        Showing <strong className="num">{from + 1}–{to}</strong> of <strong className="num">{total.toLocaleString("en-IN")}</strong> {label}
      </div>
      <div className="controls">
        <button className="pgbtn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} aria-label="Previous page">‹</button>
        {withEllipses.map((p, i) => p === "…"
          ? <span key={"el" + i} className="ellipsis">…</span>
          : <button key={p} className={"pgbtn " + (p === page ? "active" : "")}
                    onClick={() => setPage(p)}>{p}</button>
        )}
        <button className="pgbtn" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page === pageCount} aria-label="Next page">›</button>
      </div>
      <select className="size-select" value={pageSize} onChange={e => setPageSize(parseInt(e.target.value))}>
        {sizes.map(s => <option key={s} value={s}>{s} / page</option>)}
      </select>
    </div>
  );
}

// ---------- Page header ---------------------------------------------------
export function PageHeader({ eyebrow, title, subtitle, right }) {
  return (
    <header className="page-head">
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-end", gap: 16, flexWrap:"wrap"}}>
        <div style={{flex:1, minWidth: 240}}>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {subtitle && <p className="subtitle">{subtitle}</p>}
        </div>
        {right && <div style={{flexShrink:0}}>{right}</div>}
      </div>
    </header>
  );
}

// ---------- Mobile tab bar ------------------------------------------------
export function MobileTabs({ route, onRoute }) {
  const items = [
    { k: "home",        l: "Home",     i: "◐" },
    { k: "profile",     l: "Profile",  i: "✦" },
    { k: "colleges",    l: "Colleges", i: "◫" },
    { k: "predictions", l: "Predict",  i: "%" },
  ];
  return (
    <div className="mobile-tabs">
      <div className="row">
        {items.map(it => (
          <button key={it.k} className={route === it.k ? "active" : ""} onClick={() => onRoute(it.k)}>
            <span className="ico">{it.i}</span>
            <span>{it.l}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
