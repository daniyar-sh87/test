import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, seed, create, get, listUpdates } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { createApp } from "../server/index.js";
import { STUCK_DAYS, isDealOverdue, isDealStuck, summarize, migrateStage } from "../public/deals.js";

const json = { "Content-Type": "application/json" };
async function withServer(fn) {
  const db = openDb(":memory:");
  const server = createApp(db).listen(0);
  try { await fn(`http://localhost:${server.address().port}`, db); } finally { server.close(); }
}
const post = (base, path, body) => fetch(`${base}${path}`, { method: "POST", headers: json, body: JSON.stringify(body) });

/* ---------- rules ---------- */
test("Discovery maps to New; other stages are untouched", () => {
  assert.equal(migrateStage("Discovery"), "New");
  for (const s of ["New", "Qualified", "Proposal", "Won", "Lost"]) assert.equal(migrateStage(s), s);
});

test("overdue: past due date on an open deal only", () => {
  const today = "2026-10-19";
  assert.equal(isDealOverdue({ stage: "New", dueDate: "2026-10-18" }, today), true);
  assert.equal(isDealOverdue({ stage: "New", dueDate: "2026-10-19" }, today), false, "due today is not overdue");
  assert.equal(isDealOverdue({ stage: "Proposal", dueDate: "" }, today), false, "no date, no flag");
  assert.equal(isDealOverdue({ stage: "Won", dueDate: "2026-01-01" }, today), false);
  assert.equal(isDealOverdue({ stage: "Lost", dueDate: "2026-01-01" }, today), false);
});

test(`stuck: open deal with no update for ${STUCK_DAYS}+ days`, () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const ago = (d) => new Date(now.getTime() - d * 86400000).toISOString();
  assert.equal(isDealStuck({ stage: "New", lastActivityAt: ago(STUCK_DAYS) }, now), true);
  assert.equal(isDealStuck({ stage: "New", lastActivityAt: ago(STUCK_DAYS - 1) }, now), false);
  assert.equal(isDealStuck({ stage: "Won", lastActivityAt: ago(90) }, now), false);
  assert.equal(isDealStuck({ stage: "New", lastActivityAt: "garbage" }, now), false, "unreadable date is not flagged");
  assert.equal(isDealStuck({ stage: "New", statusAt: ago(30) }, now), true, "falls back to older date fields");
});

test("summary counts only open deals for value, and flags across the list", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const s = summarize([
    { stage: "New", valueM: 2, dueDate: "2026-10-01", lastActivityAt: "2026-10-18T00:00:00Z" },
    { stage: "Proposal", valueM: 3.5, dueDate: "", lastActivityAt: "2026-09-01T00:00:00Z" },
    { stage: "Won", valueM: 10, dueDate: "2026-01-01", lastActivityAt: "2025-01-01T00:00:00Z" },
  ], now);
  assert.deepEqual(s, { open: 2, value: 5.5, overdue: 1, stuck: 1 });
});

/* ---------- migration ---------- */
const legacy = () => ({
  title: "Old deal", stage: "Discovery", owner: "S. Ali", valueM: 2,
  status: "Intro call went well.", statusAt: "2026-10-01T09:00:00Z", next: "Book the DPO meeting.",
  createdAt: "2026-09-01T00:00:00Z",
});

test("migration moves stage, next step and status without losing data, and is safe to run twice", () => {
  const db = openDb(":memory:");
  const a = create(db, "opps", legacy());
  const b = create(db, "opps", { title: "No status", stage: "Qualified", createdAt: "2026-09-05T00:00:00Z" });

  const first = migrate(db);
  assert.deepEqual(first, { stages: 1, updates: 1, deals: 2 });

  const o = get(db, "opps", a.id);
  assert.equal(o.stage, "New");
  assert.equal(o.nextStep, "Book the DPO meeting.");
  assert.equal(o.dueDate, "");
  assert.equal(o.lastActivityAt, "2026-10-01T09:00:00Z");
  assert.equal(o.status, "Intro call went well.", "old fields are kept");
  assert.equal(o.next, "Book the DPO meeting.");

  const ups = listUpdates(db, a.id);
  assert.equal(ups.length, 1);
  assert.equal(ups[0].text, "Intro call went well.");
  assert.equal(ups[0].createdAt, "2026-10-01T09:00:00Z", "statusAt becomes the update time");
  assert.equal(listUpdates(db, b.id).length, 0, "no status, no update");
  assert.equal(get(db, "opps", b.id).lastActivityAt, "2026-09-05T00:00:00Z");

  const before = JSON.stringify([get(db, "opps", a.id), get(db, "opps", b.id), listUpdates(db, a.id)]);
  assert.deepEqual(migrate(db), { stages: 0, updates: 0, deals: 0 }, "second run changes nothing");
  assert.equal(JSON.stringify([get(db, "opps", a.id), get(db, "opps", b.id), listUpdates(db, a.id)]), before);
});

test("migration never overwrites a next step that was already set", () => {
  const db = openDb(":memory:");
  const o = create(db, "opps", { ...legacy(), nextStep: "Newer step", dueDate: "2026-11-01" });
  migrate(db);
  assert.equal(get(db, "opps", o.id).nextStep, "Newer step");
  assert.equal(get(db, "opps", o.id).dueDate, "2026-11-01");
});

test("seed data lands in the new model", () => {
  const db = openDb(":memory:");
  seed(db);
  for (const id of ["ex-grid", "ex-retail", "ex-traffic"]) {
    const o = get(db, "opps", id);
    assert.ok(o.nextStep, `${id} has a next step`);
    assert.ok(o.lastActivityAt);
    assert.equal(listUpdates(db, id).length, 1, `${id} status became its first update`);
  }
});

/* ---------- updates API ---------- */
test("posting an update records history and replaces next step, due date and last activity", () =>
  withServer(async (base) => {
    const deal = await (await post(base, "/api/opps", { title: "D", client: "C", owner: "Sam", stage: "New", valueM: 1, nextStep: "Call", dueDate: "2026-10-30" })).json();

    const r = await post(base, `/api/opps/${deal.id}/updates`, { author: "Sam", text: "Met the CIO", nextStep: "Send proposal", dueDate: "2026-11-15" });
    assert.equal(r.status, 201);
    const { update, opp } = await r.json();
    assert.equal(update.kind, "note");
    assert.equal(update.author, "Sam");
    assert.equal(update.text, "Met the CIO");
    assert.equal(update.nextStep, "Send proposal");
    assert.equal(opp.nextStep, "Send proposal");
    assert.equal(opp.dueDate, "2026-11-15");
    assert.ok(Date.now() - Date.parse(opp.lastActivityAt) < 5000, "lastActivityAt is now");

    const saved = await (await fetch(`${base}/api/opps/${deal.id}`)).json();
    assert.equal(saved.nextStep, "Send proposal");
    assert.equal(saved.title, "D", "other fields are untouched");

    await post(base, `/api/opps/${deal.id}/updates`, { author: "Ana", text: "Second note" });
    const hist = await (await fetch(`${base}/api/opps/${deal.id}/updates`)).json();
    assert.deepEqual(hist.map((u) => u.text), ["Second note", "Met the CIO"], "newest first");
    const after = await (await fetch(`${base}/api/opps/${deal.id}`)).json();
    assert.equal(after.nextStep, "Send proposal", "an update without nextStep keeps the current one");
  }));

test("a stage change posts an automatic 'Stage: A → B' entry", () =>
  withServer(async (base) => {
    const deal = await (await post(base, "/api/opps", { title: "D", stage: "New" })).json();
    const r = await (await post(base, `/api/opps/${deal.id}/updates`, { author: "Sam", stage: "Qualified" })).json();
    assert.equal(r.update.kind, "stage");
    assert.equal(r.update.text, "Stage: New → Qualified");
    assert.equal(r.opp.stage, "Qualified");
    const hist = await (await fetch(`${base}/api/opps/${deal.id}/updates`)).json();
    assert.equal(hist[0].text, "Stage: New → Qualified");
  }));

test("update validation and unknown deals", () =>
  withServer(async (base) => {
    const deal = await (await post(base, "/api/opps", { title: "D", stage: "New" })).json();
    const url = `/api/opps/${deal.id}/updates`;
    assert.equal((await post(base, url, { text: "no author" })).status, 400);
    assert.equal((await post(base, url, { author: "Sam" })).status, 400, "nothing to record");
    assert.equal((await post(base, url, { author: "Sam", text: "x", dueDate: "tomorrow" })).status, 400);
    assert.equal((await post(base, url, { author: "Sam", stage: "Limbo" })).status, 400);
    assert.equal((await post(base, url, { author: "Sam", stage: "New" })).status, 400, "same stage is not an update");
    assert.equal((await post(base, "/api/opps/nope/updates", { author: "Sam", text: "x" })).status, 404);
    assert.equal((await fetch(`${base}/api/opps/nope/updates`)).status, 404);
    assert.equal((await (await fetch(`${base}${url}`)).json()).length, 0, "failed posts left no history");
  }));

test("deleting a deal deletes its history", () =>
  withServer(async (base, db) => {
    const deal = await (await post(base, "/api/opps", { title: "D", stage: "New" })).json();
    await post(base, `/api/opps/${deal.id}/updates`, { author: "Sam", text: "hi" });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM updates WHERE opp_id = ?").get(deal.id).n, 1);
    await fetch(`${base}/api/opps/${deal.id}`, { method: "DELETE" });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM updates WHERE opp_id = ?").get(deal.id).n, 0);
  }));
