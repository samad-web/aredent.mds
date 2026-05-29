/* YearBar — persistent strip under the top nav.
   Shows what analysis year is active + seat-supply summary for that year.
   Default "2026 forecast" uses all data; selecting a historical year uses
   only records from earlier years to predict that year (time-machine mode). */
import React, { useMemo } from "react";
import { fmtInt } from "./ui.jsx";

export function YearBar({ analysisYear, onYearChange, records, availableYears }) {
  const stats = useMemo(() => {
    // For forecast: aggregate ALL records into "what was on offer historically".
    // For a historical year N: show the seat supply observed in year N itself.
    const targetYear = analysisYear === "forecast" ? null : analysisYear;
    const seats = targetYear
      ? records.filter(r => r.year === targetYear).length
      : records.length;
    const byQuota = {};
    const yearSet = new Set();
    const ccSet = new Set();
    for (const r of records) {
      if (targetYear && r.year !== targetYear) continue;
      byQuota[r.quota] = (byQuota[r.quota] || 0) + 1;
      yearSet.add(r.year);
      ccSet.add(r.college + "::" + r.course);
    }
    return { seats, byQuota, years: yearSet.size, combos: ccSet.size };
  }, [records, analysisYear]);

  const yearOptions = [
    { value: "forecast", label: "2026 forecast" },
    ...availableYears.slice().sort((a, b) => b - a).map(y => ({ value: y, label: String(y) })),
  ];

  return (
    <div className="yearbar">
      <div className="shell yearbar-inner">
        <div className="yearbar-left">
          <span className="yearbar-label">Analysis year</span>
          <div className="segment">
            {yearOptions.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => onYearChange(o.value)}
                className={analysisYear === o.value ? "active" : ""}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="yearbar-right">
          <span className="yearbar-stat">
            <span className="yearbar-stat-label">Allotments</span>
            <span className="num yearbar-stat-value">{fmtInt(stats.seats)}</span>
          </span>
          <span className="yearbar-stat">
            <span className="yearbar-stat-label">Combos</span>
            <span className="num yearbar-stat-value">{fmtInt(stats.combos)}</span>
          </span>
          {analysisYear === "forecast" && (
            <span className="yearbar-stat">
              <span className="yearbar-stat-label">Years</span>
              <span className="num yearbar-stat-value">{stats.years}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
