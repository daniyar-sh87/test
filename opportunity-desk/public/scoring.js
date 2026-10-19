// Scoring rules, shared by the browser (app.js) and the tests.
// Score = 40% fit + 35% value + 25% (100 − risk). Go ≥ 70, Qualify 55–69, No-go < 55.

export const LV = { H: 30, M: 15, L: 5 }; // risk points per level
export const WEIGHTS = { fit: 0.4, value: 0.35, risk: 0.25 };
export const THRESHOLDS = { go: 70, qualify: 55 };

export const arr = (v) => (Array.isArray(v) ? v : []);
export const clamp = (n, a, b) => Math.max(a, Math.min(b, Number.isFinite(+n) ? +n : a));
export const lvl = (v) => {
  const c = String(v || "").trim().charAt(0).toUpperCase();
  return c === "H" || c === "L" ? c : "M";
};

export function verdictFor(score) {
  return score >= THRESHOLDS.go ? "Go" : score >= THRESHOLDS.qualify ? "Qualify" : "No-go";
}

// Normalise a stored opportunity and add computed fields:
// fit (best product fit), risk (sum of risk points, max 100), score, verdict.
export function derive(o) {
  const products = arr(o.products).map((p) => ({ n: String(p.n || ""), f: clamp(p.f, 0, 100), note: p.note || "" })).filter((p) => p.n);
  const risks = arr(o.risks).map((r) => ({ c: r.c || "Risk", l: lvl(r.l), note: r.note || "", m: r.m || "" }));
  const fit = products.length ? Math.max(...products.map((p) => p.f)) : 0;
  const risk = Math.min(100, risks.reduce((s, r) => s + LV[r.l], 0));
  const valueScore = clamp(o.valueScore, 0, 100);
  const score = Math.round(fit * WEIGHTS.fit + valueScore * WEIGHTS.value + (100 - risk) * WEIGHTS.risk);
  return {
    ...o, products, risks, fit, risk, valueScore, score, verdict: verdictFor(score), valueM: +o.valueM || 0,
    gaps: arr(o.gaps).map(String).filter(Boolean),
    strategic: arr(o.strategic).map(String).filter(Boolean),
    stakeholders: arr(o.stakeholders).map((s) => ({ n: s.n || "", r: s.r || "", i: lvl(s.i), s: s.s || "Unknown" })),
  };
}
