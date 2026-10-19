// Deal-tracker rules, shared by the browser, the server and the tests.
// A deal needs an owner, a stage and a next step with a due date; the rest is optional detail.
import { todayStr } from "./tasks.js";

export const STAGES = ["New", "Qualified", "Proposal", "Won", "Lost"];
export const OPEN_STAGES = ["New", "Qualified", "Proposal"];
export const STUCK_DAYS = 14; // no update for this many days = "Stuck"
export const DEFAULT_DOMAINS = ["Smart City", "Energy", "Finance", "Retail"];

const DAY = 86400000;

export const isOpen = (o) => OPEN_STAGES.includes(o.stage);

// Stages removed in the simplification map onto the nearest remaining one.
export const migrateStage = (s) => (s === "Discovery" ? "New" : s);

// When the deal last had an update; falls back for records that predate lastActivityAt.
export const lastActivity = (o) => o.lastActivityAt || o.statusAt || o.updatedAt || o.createdAt || "";

export function daysSince(iso, now = new Date()) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / DAY);
}

// Overdue: the next step's due date is before today. Only open deals can be overdue.
export const isDealOverdue = (o, today = todayStr()) => isOpen(o) && !!o.dueDate && o.dueDate < today;

// Stuck: an open deal with no update for STUCK_DAYS or more.
export function isDealStuck(o, now = new Date()) {
  if (!isOpen(o)) return false;
  const d = daysSince(lastActivity(o), now);
  return d !== null && d >= STUCK_DAYS;
}

// Board summary: open pipeline value, overdue and stuck counts.
export function summarize(deals, now = new Date()) {
  const today = todayStr(now);
  const open = deals.filter(isOpen);
  return {
    open: open.length,
    value: open.reduce((s, o) => s + (+o.valueM || 0), 0),
    overdue: deals.filter((o) => isDealOverdue(o, today)).length,
    stuck: deals.filter((o) => isDealStuck(o, now)).length,
  };
}
