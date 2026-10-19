// Small DOM and formatting helpers shared by every screen.
import { daysSince } from "./deals.js";

export const $ = (s) => document.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const vc = (v) => (v === "Go" ? "v-go" : v === "Qualify" ? "v-q" : "v-no");
export const vk = (v) => (v === "Go" ? "go" : v === "Qualify" ? "q" : "no");
export const money = (n) => "$" + Math.round((+n || 0) * 10) / 10 + "M";
export const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

const DATE_OPTS = { day: "numeric", month: "short", year: "numeric" };
// Full timestamp or YYYY-MM-DD -> "19 Oct 2026". Plain dates are read at noon so time zones can't shift the day.
export const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T12:00:00" : s);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, DATE_OPTS);
};
export const fmtDateTime = (s) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { ...DATE_OPTS, hour: "2-digit", minute: "2-digit" });
};
export function ago(iso, now = new Date()) {
  const d = daysSince(iso, now);
  return d === null ? "" : d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
