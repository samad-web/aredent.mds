/* Profile gating + per-field validation. The candidate must supply a complete,
   valid profile before any prediction is generated. Each validator returns an
   error string (shown inline) or null when the value is acceptable. Empty
   optional fields return null; empty *required* fields are surfaced by the
   completeness gate, not as inline errors, so the form doesn't shout on load. */

export const RANK_MIN = 1;
export const RANK_MAX = 250000;
export const AGE_MIN = 20;
export const AGE_MAX = 80;

const hasText = (v) => typeof v === "string" && v.trim().length > 0;

// ── Field validators ────────────────────────────────────────────────────────
export function nameError(v) {
  if (!hasText(v)) return null;
  const s = v.trim();
  if (s.length < 2) return "Name looks too short.";
  if (s.length > 60) return "Keep it under 60 characters.";
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(s)) return "Letters, spaces, . ' - only.";
  return null;
}

// Indian mobile: 10 digits starting 6–9, optional +91 / 91 prefix.
export function mobileError(v) {
  if (!hasText(v)) return null;
  const d = v.replace(/\D/g, "");
  const local = d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
  if (local.length !== 10) return "Enter a 10-digit mobile number.";
  if (!/^[6-9]/.test(local)) return "Indian mobiles start with 6–9.";
  return null;
}

export function ageError(v) {
  if (v === "" || v == null || Number.isNaN(v)) return null;
  const n = Number(v);
  if (!Number.isInteger(n)) return "Whole number only.";
  if (n < AGE_MIN) return `Age must be ≥ ${AGE_MIN}.`;
  if (n > AGE_MAX) return `Age must be ≤ ${AGE_MAX}.`;
  return null;
}

export function regNumberError(v) {
  if (!hasText(v)) return null;
  if (!/^[A-Za-z0-9/-]{4,20}$/.test(v.trim())) return "4–20 letters/digits.";
  return null;
}

export function rankError(v) {
  if (v === "" || v == null || v === 0) return null;
  if (!Number.isFinite(v)) return "Enter a valid rank.";
  if (!Number.isInteger(v)) return "Whole number only.";
  if (v < RANK_MIN) return "Rank must be at least 1.";
  if (v > RANK_MAX) return `Rank looks too high (max ${RANK_MAX.toLocaleString("en-IN")}).`;
  return null;
}

export const validRank = (v) => Number.isFinite(v) && Number.isInteger(v) && v >= RANK_MIN && v <= RANK_MAX;

// ── Completeness gate ───────────────────────────────────────────────────────
// Required to proceed. Category always carries a default (UR) so it is
// implicitly satisfied; the rest must be filled AND valid.
export const REQUIRED_FIELDS = [
  { key: "name", label: "Full name" },
  { key: "mobile", label: "Mobile number" },
  { key: "neetPgRank", label: "NEET PG / MDS rank" },
  { key: "domicileState", label: "Domicile state" },
];

export function fieldFilled(student, key) {
  switch (key) {
    case "mobile": return hasText(student.mobile) && mobileError(student.mobile) === null;
    case "neetPgRank": return validRank(student.neetPgRank);
    case "name": return hasText(student.name) && nameError(student.name) === null;
    case "domicileState": return hasText(student.domicileState);
    default: return hasText(student[key]);
  }
}

export function missingProfileFields(student) {
  return REQUIRED_FIELDS.filter((f) => !fieldFilled(student, f.key));
}

export function isProfileComplete(student) {
  return missingProfileFields(student).length === 0;
}
