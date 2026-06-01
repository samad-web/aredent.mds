/* NEET PG prediction algorithm — ported from algo.js. */
import { canonicalCollegeName } from "./collegeMatch.js";
import { canonicalCourseName } from "./courseMatch.js";

export function normalCdf(z) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1.0 + sign * y);
}

function percentile(sorted, q) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function trendSlope(points) {
  if (points.length < 2) return 0;
  const maxY = Math.max(...points.map(p => p.year));
  const w = points.map(p => Math.pow(0.8, maxY - p.year));
  const sw = w.reduce((a, b) => a + b, 0);
  const mx = points.reduce((a, p, i) => a + w[i] * p.year, 0) / sw;
  const my = points.reduce((a, p, i) => a + w[i] * p.val, 0) / sw;
  let num = 0, den = 0;
  for (let i = 0; i < points.length; i++) {
    num += w[i] * (points[i].year - mx) * (points[i].val - my);
    den += w[i] * (points[i].year - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export function eligiblePools(student) {
  const pools = [];
  const r = student;

  // AIQ — UR pool always eligible; reserved candidates additionally see their category pool.
  pools.push({ id: "AIQ-UR", quota: "AIQ", category: "UR", label: "UR via AIQ" });
  if (r.category !== "UR") {
    pools.push({ id: `AIQ-${r.category}`, quota: "AIQ", category: r.category, label: `${r.category} via AIQ` });
  }

  // State quota — requires domicile.
  if (r.domicileState) {
    pools.push({ id: "ST-UR", quota: "State", category: "UR", state: r.domicileState, label: `UR via State (${r.domicileState})` });
    if (r.category !== "UR") {
      pools.push({ id: `ST-${r.category}`, quota: "State", category: r.category, state: r.domicileState, label: `${r.category} via State (${r.domicileState})` });
    }
    // In-service in NEET PG is a state-quota reservation in the candidate's home state,
    // NOT an AIQ pool. Requires both isInService AND domicileState.
    if (r.isInService) {
      pools.push({ id: "ST-InService", quota: "State", category: r.category, state: r.domicileState, isInService: true, label: `In-service via State (${r.domicileState})` });
    }
  }

  // Open to all NEET PG candidates who can apply (Deemed = self-pay, Central-INI = AIIMS/JIPMER/PGI feeder, DNB = National Board).
  for (const q of ["Deemed", "Central-INI", "DNB"]) {
    pools.push({ id: `${q}-UR`, quota: q, category: "UR", label: `UR via ${q}` });
    if (r.category !== "UR") pools.push({ id: `${q}-${r.category}`, quota: q, category: r.category, label: `${r.category} via ${q}` });
  }

  // ESIC — only ESI-Act insured beneficiaries (Insured Persons and their wards) qualify.
  // Adding it to every student inflates P; gate on the explicit flag.
  if (r.isESICBeneficiary) {
    pools.push({ id: "ESIC-UR", quota: "ESIC", category: "UR", label: "UR via ESIC" });
    if (r.category !== "UR") pools.push({ id: `ESIC-${r.category}`, quota: "ESIC", category: r.category, label: `${r.category} via ESIC` });
  }

  // AFMS — restricted to Armed Forces officers. Same gating reasoning as ESIC.
  if (r.isAFMSCandidate) {
    pools.push({ id: "AFMS-UR", quota: "AFMS", category: "UR", label: "UR via AFMS" });
    if (r.category !== "UR") pools.push({ id: `AFMS-${r.category}`, quota: "AFMS", category: r.category, label: `${r.category} via AFMS` });
  }

  // PwBD is a horizontal 5% reservation — adds an additional eligible pool overlay
  // alongside each open pool, it does NOT replace the open-category pool.
  if (r.isPwBD) {
    const pwbdOverlays = pools.map(p => ({
      ...p,
      id: `${p.id}+PwBD`,
      requirePwBD: true,
      label: `${p.label} (PwBD)`,
    }));
    pools.push(...pwbdOverlays);
  }

  return pools;
}

function filterPool(records, pool) {
  return records.filter(r => {
    if (r.quota !== pool.quota) return false;
    // Unknown category (MDS R1 seats / admitted-lists carry no category in the
    // source) is treated as open competition → feeds the UR pool only, rather
    // than being dropped from every pool. PG rows are always categorized.
    const cat = r.category ?? "UR";
    if (cat !== pool.category) return false;
    if (pool.state && r.state !== pool.state) return false;
    if (pool.requirePwBD && !r.isPwBD) return false;
    if (pool.isInService && !r.isInService) return false;
    return true;
  });
}

function groupStats(records, opts = {}) {
  const { useRound } = opts;
  const byYearRound = new Map();
  for (const r of records) {
    const rk = useRound ? `${r.year}::${r.round || "Final"}` : `${r.year}`;
    if (!byYearRound.has(rk)) byYearRound.set(rk, []);
    byYearRound.get(rk).push(r.rank);
  }
  const yearPts = [];
  for (const [k, ranks] of byYearRound.entries()) {
    ranks.sort((a, b) => a - b);
    const closing = percentile(ranks, 0.95);
    yearPts.push({ year: parseInt(k), val: closing, n: ranks.length, ranks });
  }
  yearPts.sort((a, b) => a.year - b.year);
  if (!yearPts.length) return null;

  const closings = yearPts.map(p => p.val);
  const sigma = stdev(closings);
  const slope = yearPts.length >= 2 ? trendSlope(yearPts) : 0;
  const lastVal = yearPts[yearPts.length - 1].val;
  let forecast;
  if (yearPts.length >= 2) {
    const projected = lastVal + slope;
    const cap = lastVal * 0.25;
    forecast = lastVal + Math.max(-cap, Math.min(cap, projected - lastVal));
  } else {
    forecast = lastVal;
  }
  // Forecast SE: σ across years OR a relative-noise floor. Cold-start (1 year)
  // widens to 20% because we have no σ measurement — the model should be honest
  // about its uncertainty when extrapolating from a single point.
  const relFloor = yearPts.length === 1 ? 0.20 : 0.10;
  const forecastSE = Math.max(sigma, relFloor * Math.abs(forecast || 1));
  const totalN = yearPts.reduce((a, p) => a + p.n, 0);
  return { yearPts, sigma, slope, forecast, forecastSE, totalN, lastVal };
}

export function predictCollegeCourse(college, course, student, allRecords, _options) {
  const pools = (_options && _options.pools) || eligiblePools(student);
  const recs = (_options && _options.recs) || allRecords.filter(r => r.college === college && r.course === course);
  if (!recs.length) return null;

  const poolEval = [];
  for (const pool of pools) {
    const sub = filterPool(recs, pool);
    if (!sub.length) continue;
    const stats = groupStats(sub);
    if (!stats) continue;
    const z = (stats.forecast - student.neetPgRank) / stats.forecastSE;
    const p = normalCdf(z);
    const pHi = normalCdf((stats.forecast + 1.96 * stats.forecastSE - student.neetPgRank) / stats.forecastSE);
    const pLo = normalCdf((stats.forecast - 1.96 * stats.forecastSE - student.neetPgRank) / stats.forecastSE);
    poolEval.push({ pool, stats, p, pLo, pHi, sampleN: sub.length });
  }
  if (!poolEval.length) return null;

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const oneMinus = poolEval.reduce((a, pe) => a * (1 - pe.p), 1);
  const P = clamp(1 - oneMinus, 0.01, 0.99);
  // Clamp the CI to the same range as P. Without this the band can contradict the
  // point estimate at the extremes (e.g. P floored to 0.01 while ciHi is ~0).
  // clamp is monotonic, so raw ciLo <= P <= ciHi is preserved after clamping.
  const ciHi = clamp(1 - poolEval.reduce((a, pe) => a * (1 - pe.pHi), 1), 0.01, 0.99);
  const ciLo = clamp(1 - poolEval.reduce((a, pe) => a * (1 - pe.pLo), 1), 0.01, 0.99);

  const roundP = (roundFilter) => {
    const peR = [];
    for (const pool of pools) {
      const sub = filterPool(recs, pool).filter(r => roundFilter(r.round));
      if (!sub.length) continue;
      const st = groupStats(sub);
      if (!st) continue;
      const z = (st.forecast - student.neetPgRank) / st.forecastSE;
      peR.push(normalCdf(z));
    }
    if (!peR.length) return null;
    let pp = 1 - peR.reduce((a, p) => a * (1 - p), 1);
    return clamp(pp, 0.01, 0.99);
  };
  const pR1 = roundP(rd => rd === "R1");
  const pR3 = roundP(rd => ["R1", "R2", "R3", "Mop-up"].includes(rd));
  const pStray = roundP(rd => true);

  const tier = ((pp) => {
    if (pp >= 0.85) return "Safe";
    if (pp >= 0.65) return "Likely";
    if (pp >= 0.40) return "Target";
    if (pp >= 0.15) return "Reach";
    return "Unlikely";
  })(pStray ?? P);

  poolEval.sort((a, b) => b.p - a.p);
  const drivingPool = poolEval[0];

  const slope = drivingPool.stats.slope;
  const forecast = drivingPool.stats.forecast || 1;
  const slopePct = slope / forecast;
  const trendLabel = slopePct > 0.05 ? "Loosening" : slopePct < -0.05 ? "Tightening" : "Stable";

  const sigmaPct = drivingPool.stats.sigma / Math.max(1, drivingPool.stats.forecast);
  const volLabel = sigmaPct < 0.10 ? "Low" : sigmaPct < 0.25 ? "Medium" : "High";

  const rankGap = drivingPool.stats.forecast - student.neetPgRank;
  const rankGapPct = rankGap / Math.max(1, drivingPool.stats.forecast);

  const yearCount = new Set(recs.map(r => r.year)).size;
  const samplesTotal = recs.length;
  const thinData = samplesTotal / Math.max(1, yearCount) < 3;

  const drvRecs = filterPool(recs, drivingPool.pool);
  const roundMix = {};
  for (const r of drvRecs) roundMix[r.round || "Final"] = (roundMix[r.round || "Final"] || 0) + 1;

  const yearByRoundChart = (() => {
    const rounds = ["R1", "R2", "R3", "Mop-up", "Stray"];
    const map = new Map();
    for (const r of drvRecs) {
      const k = `${r.year}::${r.round || "Final"}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r.rank);
    }
    const data = [];
    const years = Array.from(new Set(drvRecs.map(r => r.year))).sort();
    for (const y of years) {
      const row = { year: y };
      for (const rd of rounds) {
        const arr = map.get(`${y}::${rd}`);
        row[rd] = arr ? percentile(arr.sort((a, b) => a - b), 0.95) : null;
      }
      data.push(row);
    }
    return data;
  })();

  return {
    college, course,
    P, ciLo, ciHi, tier,
    pByRound: { R1: pR1, byR3: pR3, byStray: pStray },
    drivingPool: {
      label: drivingPool.pool.label,
      p: drivingPool.p, ciLo: drivingPool.pLo, ciHi: drivingPool.pHi,
      forecast: drivingPool.stats.forecast,
      forecastSE: drivingPool.stats.forecastSE,
      slope: drivingPool.stats.slope,
      sigma: drivingPool.stats.sigma,
      yearPts: drivingPool.stats.yearPts,
      sampleN: drivingPool.sampleN,
    },
    pools: poolEval.map(pe => ({
      label: pe.pool.label, p: pe.p, n: pe.sampleN,
      forecast: pe.stats.forecast, se: pe.stats.forecastSE,
    })),
    rankGap, rankGapPct, trendLabel, volLabel, sigmaPct,
    yearCount, samplesTotal, thinData,
    roundMix,
    yearByRoundChart,
  };
}

export function predictAll(student, records) {
  // Pre-index once: group records by (canonical-college, course). Resolving
  // each free-text college name to its canonical master-list entry collapses
  // MCC's verbose strings ("Maulana Azad Medical College, Delhi (NCT)") down
  // to the same bucket as our bundled name ("Maulana Azad Medical College"),
  // letting predictions show with rich metadata. Names that don't resolve are
  // grouped by their original string (predictions still work).
  const SEP = "␟"; // unit separator
  const byCC = new Map();
  for (const r of records) {
    const canonCollege = canonicalCollegeName(r.college);
    const canonCourse = canonicalCourseName(r.course);
    const k = canonCollege + SEP + canonCourse;
    let arr = byCC.get(k);
    if (!arr) { arr = []; byCC.set(k, arr); }
    // Tag the record with canonical labels so downstream code (deep-dive,
    // college metadata, peer suggestions) sees them too.
    arr.push(
      canonCollege === r.college && canonCourse === r.course
        ? r
        : { ...r, college: canonCollege, course: canonCourse }
    );
  }
  // Eligible pools depend only on the student, so compute once and reuse.
  const pools = eligiblePools(student);
  const out = [];
  for (const [k, ccRecords] of byCC) {
    const sepIdx = k.indexOf(SEP);
    const college = k.slice(0, sepIdx);
    const course = k.slice(sepIdx + 1);
    const p = predictCollegeCourse(college, course, student, null, { pools, recs: ccRecords });
    if (p) out.push(p);
  }
  return out;
}

export function runBacktest(records) {
  const years = Array.from(new Set(records.map(r => r.year))).sort();
  if (years.length < 2) return null;
  const holdout = years[years.length - 1];
  const train = records.filter(r => r.year < holdout);
  const test = records.filter(r => r.year === holdout);

  // Pre-index train by (college, course, quota, category) to avoid O(N²) filters.
  const trainIndex = new Map();
  for (const r of train) {
    const k = `${r.college}␟${r.course}␟${r.quota}␟${r.category}`;
    let arr = trainIndex.get(k);
    if (!arr) { arr = []; trainIndex.set(k, arr); }
    arr.push(r);
  }

  // Group test rows by the same key so we can compute realized closing rank.
  const testGroups = new Map();
  for (const r of test) {
    const k = `${r.college}␟${r.course}␟${r.quota}␟${r.category}`;
    let arr = testGroups.get(k);
    if (!arr) { arr = []; testGroups.set(k, arr); }
    arr.push(r.rank);
  }

  const tierCounts = { Safe: [0, 0], Likely: [0, 0], Target: [0, 0], Reach: [0, 0], Unlikely: [0, 0] };

  // Sample at multiples of the realized closing rank. This sweeps across tiers
  // by construction: 0.4x sits well below cutoff (should be Safe + admitted),
  // 0.85x sits near cutoff (Target boundary), 1.5x sits above (Reach), 3x sits
  // far above (Unlikely + rejected). The previous percentiles-of-admittees
  // approach only sampled below-cutoff ranks, making the test tautological.
  const multiples = [0.4, 0.7, 0.85, 1.0, 1.5, 3.0];

  for (const [k, ranks] of testGroups) {
    if (ranks.length < 2) continue;
    ranks.sort((a, b) => a - b);
    const realizedClosing = percentile(ranks, 0.95);
    const trainSub = trainIndex.get(k);
    if (!trainSub || trainSub.length < 3) continue;

    const stats = groupStats(trainSub);
    if (!stats) continue;

    for (const m of multiples) {
      const candidateRank = Math.max(1, Math.round(realizedClosing * m));
      const z = (stats.forecast - candidateRank) / stats.forecastSE;
      const p = normalCdf(z);
      const tier = p >= 0.85 ? "Safe" : p >= 0.65 ? "Likely" : p >= 0.40 ? "Target" : p >= 0.15 ? "Reach" : "Unlikely";
      // "Admitted" iff their rank was at or below the realized 95th-percentile cutoff.
      const got = candidateRank <= realizedClosing;
      tierCounts[tier][1]++;
      if (got) tierCounts[tier][0]++;
    }
  }
  const out = {};
  for (const [tier, [hits, total]] of Object.entries(tierCounts)) {
    out[tier] = { hits, total, rate: total > 0 ? hits / total : null };
  }
  return { holdoutYear: holdout, perTier: out };
}
