// SQLite document store. Each row keeps the record as JSON in `data`,
// mirroring the document model the prototype used, so the frontend and
// the shape of an opportunity stay unchanged. Deal updates (the history of
// each opportunity) live in their own `updates` table.
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGES } from "../public/deals.js";
import { migrate } from "./migrate.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const COLLECTIONS = ["opps", "products"];

export function openDb(file = process.env.DB_PATH || join(ROOT, "data", "opportunity-desk.db")) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  for (const c of COLLECTIONS) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${c} (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS updates (
    id TEXT PRIMARY KEY,
    opp_id TEXT NOT NULL,
    author TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    next_step TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS updates_opp ON updates (opp_id, created_at)`);
  migrate(db);
  return db;
}

const check = (c) => {
  if (!COLLECTIONS.includes(c)) throw Object.assign(new Error("Unknown collection"), { status: 404 });
};
const row = (r) => ({ ...JSON.parse(r.data), id: r.id });

export function list(db, c) {
  check(c);
  return db.prepare(`SELECT * FROM ${c} ORDER BY created_at`).all().map(row);
}

export function get(db, c, id) {
  check(c);
  const r = db.prepare(`SELECT * FROM ${c} WHERE id = ?`).get(id);
  return r ? row(r) : null;
}

export function create(db, c, data, id = randomUUID()) {
  check(c);
  const now = new Date().toISOString();
  const { id: _ignored, ...body } = data;
  db.prepare(`INSERT INTO ${c} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(id, JSON.stringify(body), body.createdAt || now, now);
  return get(db, c, id);
}

export function replace(db, c, id, data) {
  check(c);
  const { id: _ignored, ...body } = data;
  const res = db.prepare(`UPDATE ${c} SET data = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(body), new Date().toISOString(), id);
  return res.changes ? get(db, c, id) : null;
}

export function remove(db, c, id) {
  check(c);
  const gone = db.prepare(`DELETE FROM ${c} WHERE id = ?`).run(id).changes > 0;
  if (gone && c === "opps") db.prepare("DELETE FROM updates WHERE opp_id = ?").run(id);
  return gone;
}

/* ---------- updates (deal history) ---------- */
const httpErr = (status, message) => Object.assign(new Error(message), { status });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v) => (typeof v === "string" ? v.trim() : "");
const updateRow = (r) => ({ id: r.id, oppId: r.opp_id, author: r.author, kind: r.kind, text: r.text, nextStep: r.next_step, dueDate: r.due_date, createdAt: r.created_at });

// Newest first. Returns null when the deal doesn't exist.
export function listUpdates(db, oppId) {
  if (!get(db, "opps", oppId)) return null;
  return db.prepare("SELECT * FROM updates WHERE opp_id = ? ORDER BY created_at DESC, rowid DESC").all(oppId).map(updateRow);
}

// Post an update. In one transaction: add the history entry and apply it to the deal
// (nextStep / dueDate when sent, stage when it changes, lastActivityAt always).
// A changed `stage` makes it a "stage" entry whose text is generated ("Stage: New → Qualified").
export function addUpdate(db, oppId, input = {}) {
  const opp = get(db, "opps", oppId);
  if (!opp) throw httpErr(404, "Not found");
  const author = str(input.author);
  if (!author) throw httpErr(400, "Enter your name before posting an update.");
  const dueDate = str(input.dueDate);
  if (dueDate && !DATE.test(dueDate)) throw httpErr(400, "Due date must be YYYY-MM-DD.");

  const now = new Date().toISOString();
  const next = { ...opp };
  let kind = "note";
  let text = str(input.text);

  if (input.stage !== undefined && input.stage !== opp.stage) {
    if (!STAGES.includes(input.stage)) throw httpErr(400, "Unknown stage.");
    kind = "stage";
    text = `Stage: ${opp.stage || "New"} → ${input.stage}`;
    next.stage = input.stage;
  } else if (!text && !str(input.nextStep)) {
    throw httpErr(400, "Say what happened or set a next step.");
  }
  if (typeof input.nextStep === "string") next.nextStep = str(input.nextStep);
  if (typeof input.dueDate === "string") next.dueDate = dueDate;
  next.lastActivityAt = now;

  const id = randomUUID();
  const saved = db.transaction(() => {
    db.prepare(`INSERT INTO updates (id, opp_id, author, kind, text, next_step, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, oppId, author, kind, text, typeof input.nextStep === "string" ? next.nextStep : "", typeof input.dueDate === "string" ? dueDate : "", now);
    return replace(db, "opps", oppId, next);
  })();
  return { update: updateRow(db.prepare("SELECT * FROM updates WHERE id = ?").get(id)), opp: saved };
}

// Load seed/*.json into empty tables (or all tables when reset is true).
export function seed(db, { reset = false } = {}) {
  const counts = {};
  for (const c of COLLECTIONS) {
    if (reset) db.prepare(`DELETE FROM ${c}`).run();
    const empty = db.prepare(`SELECT COUNT(*) AS n FROM ${c}`).get().n === 0;
    const file = join(ROOT, "seed", `${c}.json`);
    counts[c] = 0;
    if (!empty || !existsSync(file)) continue;
    const rows = JSON.parse(readFileSync(file, "utf8"));
    db.transaction(() => rows.forEach((r) => { create(db, c, r, r.id); counts[c]++; }))();
  }
  if (reset) db.prepare("DELETE FROM updates").run();
  migrate(db);
  return counts;
}
