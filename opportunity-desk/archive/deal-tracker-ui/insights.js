// Executive charts from the previous Pipeline screen: summary strip, fit-vs-value quadrant,
// stage funnel and deal-size buckets. NOTHING IMPORTS THIS FILE right now; it is kept so the
// charts can come back later (e.g. as an "Insights" tab). Each function is pure: pass in the
// deals (already run through derive()) and any selection state, get HTML/SVG back.
// Note: the funnel's stage list is the old six-stage funnel; update it to STAGES before reuse.
import { clamp } from "./scoring.js";
import { esc, money, vk } from "./util.js";

export const BUCKETS = [
  { k: "b0", l: "< $1M", min: 0, max: 1 }, { k: "b1", l: "$1–3M", min: 1, max: 3 }, { k: "b3", l: "$3–5M", min: 3, max: 5 },
  { k: "b5", l: "$5–10M", min: 5, max: 10 }, { k: "b10", l: "$10M+", min: 10, max: Infinity },
];
export const inBucket = (o, k) => { const b = BUCKETS.find((x) => x.k === k); return !b || (o.valueM >= b.min && o.valueM < b.max); };
export const FUNNEL = ["New", "Discovery", "Qualified", "Proposal", "Won"];

export function summaryHtml(list) {
  const go = list.filter((o) => o.verdict === "Go");
  const total = list.reduce((s, o) => s + o.valueM, 0);
  const counts = {}; list.forEach((o) => o.products.filter((p) => p.f >= 60).forEach((p) => (counts[p.n] = (counts[p.n] || 0) + 1)));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4); const max = top[0]?.[1] || 1;
  return `<section class="summary" aria-label="Pipeline summary">
   <div class="stat"><span class="label">Opportunities</span><b class="num">${list.length}</b><small>${new Set(list.map((o) => o.domain)).size} domains</small></div>
   <div class="stat"><span class="label">Pipeline value</span><b class="num">${money(total)}</b><small>${money(go.reduce((s, o) => s + o.valueM, 0))} rated Go</small></div>
   <div class="stat"><span class="label">Verdicts</span><b class="num">${go.length} · ${list.filter((o) => o.verdict === "Qualify").length} · ${list.filter((o) => o.verdict === "No-go").length}</b><small>Go · Qualify · No-go</small></div>
   <div class="stat"><span class="label">Product demand (fit ≥ 60%)</span><div class="demand">${top.length ? top.map(([n, c]) => `<div class="bar"><span>${esc(n)}</span><span class="track"><i style="width:${c / max * 100}%"></i></span><span class="num">${c}</span></div>`).join("") : `<small>No strong product matches yet</small>`}</div></div>
  </section>`;
}

export function funnelHtml(list, stageFilter = null) {
  const all = [...FUNNEL, "Lost"];
  const rows = all.map((st) => { const os = list.filter((o) => o.stage === st); return { s: st, n: os.length, v: os.reduce((a, o) => a + o.valueM, 0) }; });
  const max = Math.max(1, ...rows.map((r) => r.n));
  return `<div class="hfunnel">${rows.map((r) => `<button class="fstage${r.s === "Lost" ? " lost" : ""}" id="st-${r.s}" data-s="${esc(r.s)}" aria-pressed="${stageFilter === r.s}" ${stageFilter && stageFilter !== r.s ? 'data-dim="1"' : ""} aria-label="${esc(r.s)}: ${r.n} leads, ${money(r.v)}">
     <span class="fcount num">${r.n}</span>
     <span class="ftrack"><span class="fbar" style="height:${r.n ? Math.max(18, r.n / max * 100) : 6}%"></span></span>
     <span class="fname">${esc(r.s)}</span><span class="fval num">${money(r.v)}</span></button>`).join("")}</div>`;
}

export function bucketHtml(list, bucketFilter = null) {
  const rows = BUCKETS.map((b) => ({ ...b, n: list.filter((o) => inBucket(o, b.k)).length }));
  const max = Math.max(1, ...rows.map((r) => r.n));
  return `<div class="bchart">${rows.map((r) => `<button class="bcol" id="bk-${r.k}" data-b="${r.k}" aria-pressed="${bucketFilter === r.k}" ${bucketFilter && bucketFilter !== r.k ? 'data-dim="1"' : ""} aria-label="${esc(r.l)}: ${r.n} leads">
     <span class="bcount num">${r.n}</span><span class="btrack"><span class="bbar" style="height:${r.n ? r.n / max * 100 : 0}%"></span></span><span class="fname">${esc(r.l)}</span></button>`).join("")}</div>`;
}

// Scatter of solution fit (x) against value (y), split at 50. `current` highlights one deal's id.
export function chartSvg(items, current = null) {
  const W = 560, H = 340, L = 46, R = 12, T = 12, B = 42, pw = W - L - R, ph = H - T - B;
  const x = (v) => L + v / 100 * pw, y = (v) => T + (100 - v) / 100 * ph;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter plot of solution fit against value with four quadrants">`;
  s += `<rect class="c-quad-lo" x="${x(0)}" y="${y(100)}" width="${pw / 2}" height="${ph / 2}"/>`;
  s += `<rect class="c-quad-hi" x="${x(50)}" y="${y(100)}" width="${pw / 2}" height="${ph / 2}"/>`;
  s += `<rect class="c-quad-lo" x="${x(0)}" y="${y(50)}" width="${pw / 2}" height="${ph / 2}"/>`;
  s += `<rect class="c-quad-lo" x="${x(50)}" y="${y(50)}" width="${pw / 2}" height="${ph / 2}"/>`;
  [0, 25, 75, 100].forEach((t) => { s += `<line class="c-grid" x1="${x(t)}" x2="${x(t)}" y1="${y(0)}" y2="${y(100)}"/><line class="c-grid" x1="${x(0)}" x2="${x(100)}" y1="${y(t)}" y2="${y(t)}"/>`; });
  s += `<line class="c-mid" x1="${x(50)}" x2="${x(50)}" y1="${y(0)}" y2="${y(100)}"/><line class="c-mid" x1="${x(0)}" x2="${x(100)}" y1="${y(50)}" y2="${y(50)}"/>`;
  [0, 25, 50, 75, 100].forEach((t) => { s += `<text class="c-tick" x="${x(t)}" y="${y(0) + 16}" text-anchor="middle">${t}</text><text class="c-tick" x="${x(0) - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`; });
  s += `<text class="c-axis" x="${x(50)}" y="${H - 6}" text-anchor="middle">Solution fit →</text>`;
  s += `<text class="c-axis" transform="translate(14 ${y(50)}) rotate(-90)" text-anchor="middle">Value →</text>`;
  s += `<text class="c-quadlbl" x="${x(0) + 10}" y="${y(100) + 20}">Build or partner</text>`;
  s += `<text class="c-quadlbl hi" x="${x(100) - 10}" y="${y(100) + 20}" text-anchor="end">Pursue</text>`;
  s += `<text class="c-quadlbl" x="${x(0) + 10}" y="${y(0) - 10}">Deprioritise</text>`;
  s += `<text class="c-quadlbl" x="${x(100) - 10}" y="${y(0) - 10}" text-anchor="end">Quick wins</text>`;
  const sorted = [...items].sort((a, b) => b.valueM - a.valueM);
  let sel = "";
  sorted.forEach((o) => {
    const r = Math.min(22, 6 + Math.sqrt(Math.max(0, o.valueM)) * 4);
    const cx = x(clamp(o.fit, 2, 98)), cy = y(clamp(o.valueScore, 2, 98));
    s += `<circle class="dot ${vk(o.verdict)}${o.id === current ? " sel" : ""}" data-id="${esc(o.id)}" cx="${cx}" cy="${cy}" r="${r}" tabindex="0" role="button" aria-label="${esc(o.title)}: fit ${o.fit}, value ${o.valueScore}"><title>${esc(o.title)} — fit ${o.fit}, value ${o.valueScore}, ${money(o.valueM)}</title></circle>`;
    if (o.id === current) {
      const t = o.title.length > 34 ? o.title.slice(0, 33) + "…" : o.title;
      const right = cx < W - 200; const tx = right ? cx + r + 6 : cx - r - 6;
      const w = t.length * 6.6 + 10;
      sel = `<rect class="c-selbg" x="${right ? tx - 4 : tx - w + 4}" y="${cy - 11}" width="${w}" height="20" rx="4"/><text class="c-sel" x="${tx}" y="${cy + 4}" text-anchor="${right ? "start" : "end"}">${esc(t)}</text>`;
    }
  });
  return s + sel + `</svg>`;
}
