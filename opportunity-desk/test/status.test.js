import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, create } from "../server/db.js";
import { createApp } from "../server/index.js";
import { buildStatusPrompt, setClient } from "../server/ai.js";

const json = { "Content-Type": "application/json" };
const tasks = [
  { id: "a", ws: "Pricing", t: "Pricing model", owner: "Sam", due: "2026-10-10", status: "Blocked" },
  { id: "b", ws: "Demo", t: "Build demo", owner: "Ana", due: "2026-11-05", status: "In progress" },
  { id: "c", ws: "Demo", t: "Demo script", owner: "Ana", due: "2026-10-01", status: "Done" },
];

async function withServer(fn) {
  const db = openDb(":memory:");
  const server = createApp(db).listen(0);
  try { await fn(`http://localhost:${server.address().port}`, db); } finally { server.close(); }
}
const ask = (base, id) => fetch(`${base}/api/ai/status`, { method: "POST", headers: json, body: JSON.stringify({ id }) });

test("status prompt lists tasks by workstream and marks overdue ones itself", () => {
  const p = buildStatusPrompt({ title: "Grid", client: "Utility", stage: "Proposal", tasks }, "2026-10-19");
  assert.match(p, /Grid for Utility/);
  assert.match(p, /\[Blocked, OVERDUE\] Pricing model \(owner: Sam/);
  assert.match(p, /\[In progress\] Build demo/);
  assert.doesNotMatch(p, /\[Done, OVERDUE\]/, "a done task is never overdue");
  assert.ok(p.indexOf("Demo:") < p.indexOf("Pricing:"), "workstream order is kept");
});

test("status suggestion: unknown deal, AI off, no tasks, and the happy path", () =>
  withServer(async (base, db) => {
    const saved = process.env.ANTHROPIC_API_KEY;
    try {
      const withTasks = create(db, "opps", { title: "D", stage: "New", tasks });
      const noTasks = create(db, "opps", { title: "E", stage: "New" });

      assert.equal((await ask(base, "nope")).status, 404);

      delete process.env.ANTHROPIC_API_KEY;
      const off = await ask(base, withTasks.id);
      assert.equal(off.status, 503);
      assert.equal((await off.json()).code, "ai_unavailable");

      process.env.ANTHROPIC_API_KEY = "test-key";
      let prompt = "";
      setClient({ messages: { create: async (req) => { prompt = req.messages[0].content; return { content: [{ type: "text", text: ' "Demo is in progress; pricing is blocked and overdue (Sam)." ' }] }; } } });

      const none = await ask(base, noTasks.id);
      assert.equal(none.status, 400);
      assert.equal((await none.json()).code, "no_tasks");

      const ok = await ask(base, withTasks.id);
      assert.equal(ok.status, 200);
      assert.equal((await ok.json()).text, "Demo is in progress; pricing is blocked and overdue (Sam).", "trimmed and unquoted");
      assert.match(prompt, /Pricing model/);

      setClient({ messages: { create: async () => { throw Object.assign(new Error("x"), { status: 429 }); } } });
      assert.equal((await ask(base, withTasks.id)).status, 429);
      setClient({ messages: { create: async () => ({ content: [{ type: "text", text: "  " }] }) } });
      assert.equal((await ask(base, withTasks.id)).status, 502, "empty answer is an error, not a blank status");
    } finally {
      setClient(undefined);
      if (saved) process.env.ANTHROPIC_API_KEY = saved; else delete process.env.ANTHROPIC_API_KEY;
    }
  }));
