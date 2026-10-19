import { test } from "node:test";
import assert from "node:assert/strict";
import { normTasks, groupTasks, taskStats, isOverdue, todayStr, nextAction, WORKSTREAMS } from "../public/tasks.js";

test("next action is the earliest-due open task that isn't blocked", () => {
  const t = (id, status, due) => ({ id, status, due });
  assert.equal(nextAction([t("late", "To do", "2026-12-01"), t("soon", "In progress", "2026-11-01"), t("done", "Done", "2026-01-01")]).id, "soon");
  assert.equal(nextAction([t("blocked", "Blocked", "2026-10-01"), t("ready", "To do", "2026-12-01")]).id, "ready", "blocked tasks are skipped while others are ready");
  assert.equal(nextAction([t("b1", "Blocked", "2026-12-01"), t("b2", "Blocked", "2026-11-01")]).id, "b2", "all blocked: earliest blocked one");
  assert.equal(nextAction([t("none", "To do", ""), t("dated", "To do", "2026-12-31")]).id, "dated", "undated tasks come last");
  assert.equal(nextAction([t("first", "To do", ""), t("second", "To do", "")]).id, "first", "ties keep list order");
  assert.equal(nextAction([t("d", "Done", "2026-01-01")]), null, "everything done");
  assert.equal(nextAction([]), null);
  assert.equal(nextAction(undefined), null);
});

test("normTasks cleans input and drops untitled tasks", () => {
  const t = normTasks([
    { id: "a", ws: "pricing", t: " Price model ", owner: " Sam ", due: "2026-11-01", status: "in progress" },
    { ws: "nonsense", t: "Fallbacks", due: "01/11/2026", status: "??" },
    { ws: "Demo", t: "  " },
    null,
  ]);
  assert.equal(t.length, 2);
  assert.deepEqual({ ...t[0] }, { id: "a", ws: "Pricing", t: "Price model", owner: "Sam", due: "2026-11-01", status: "In progress" });
  assert.equal(t[1].ws, WORKSTREAMS[0]);
  assert.equal(t[1].due, "");
  assert.equal(t[1].status, "To do");
  assert.ok(t[1].id);
  assert.deepEqual(normTasks(undefined), []);
});

test("overdue ignores done and undated tasks", () => {
  const today = "2026-10-19";
  assert.equal(isOverdue({ status: "To do", due: "2026-10-18" }, today), true);
  assert.equal(isOverdue({ status: "To do", due: "2026-10-19" }, today), false);
  assert.equal(isOverdue({ status: "Done", due: "2026-10-01" }, today), false);
  assert.equal(isOverdue({ status: "Blocked", due: "" }, today), false);
});

test("groupTasks follows workstream order, open before done, earliest due first", () => {
  const g = groupTasks([
    { ws: "Pricing", t: "done one", status: "Done", due: "2026-10-01" },
    { ws: "Demo", t: "x", status: "To do", due: "" },
    { ws: "Pricing", t: "late", status: "To do", due: "2026-12-01" },
    { ws: "Pricing", t: "soon", status: "To do", due: "2026-11-01" },
  ]);
  assert.deepEqual(g.map((x) => x.ws), ["Demo", "Pricing"]);
  assert.deepEqual(g[1].tasks.map((x) => x.t), ["soon", "late", "done one"]);
});

test("taskStats counts done, blocked and overdue", () => {
  const s = taskStats([
    { status: "Done", due: "2026-10-01" },
    { status: "Blocked", due: "2026-10-10" },
    { status: "To do", due: "2026-12-01" },
  ], "2026-10-19");
  assert.deepEqual(s, { total: 3, done: 1, blocked: 1, overdue: 1 });
});

test("tasks round-trip through the API", async () => {
  const { openDb } = await import("../server/db.js");
  const { createApp } = await import("../server/index.js");
  const server = createApp(openDb(":memory:")).listen(0);
  const base = `http://localhost:${server.address().port}`;
  try {
    const tasks = [{ id: "t1", ws: "Demo", t: "Build demo", owner: "Ana", due: "2026-11-05", status: "To do" }];
    const created = await (await fetch(`${base}/api/opps`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "T", tasks }) })).json();
    const got = await (await fetch(`${base}/api/opps/${created.id}`)).json();
    assert.deepEqual(got.tasks, tasks);
  } finally { server.close(); }
});

test("seed deals are well formed: valid tasks, a next action, current domains, unique ids", async () => {
  const { readFileSync } = await import("node:fs");
  const { derive } = await import("../public/scoring.js");
  const { DEFAULT_DOMAINS } = await import("../public/deals.js");
  const opps = JSON.parse(readFileSync(new URL("../seed/opps.json", import.meta.url), "utf8"));
  assert.equal(new Set(opps.map((o) => o.id)).size, opps.length, "unique deal ids");
  for (const o of opps) {
    assert.ok(DEFAULT_DOMAINS.includes(o.domain), `${o.id} uses a current domain`);
    const clean = normTasks(o.tasks);
    assert.equal(clean.length, o.tasks.length, `${o.id}: no task was dropped by normTasks`);
    assert.deepEqual(clean.map((t) => ({ ...t })), o.tasks, `${o.id}: tasks are already normalised`);
    assert.ok(nextAction(clean), `${o.id} has an open task to act as its next action`);
    assert.ok(["Go", "Qualify", "No-go"].includes(derive(o).verdict));
  }
  assert.deepEqual([...new Set(opps.map((o) => derive(o).verdict))].sort(), ["Go", "No-go", "Qualify"], "seed shows all three verdicts");
});

test("todayStr formats local date", () => {
  assert.equal(todayStr(new Date(2026, 0, 5)), "2026-01-05");
});
