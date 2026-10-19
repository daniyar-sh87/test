import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, seed } from "../server/db.js";
import { createApp } from "../server/index.js";
import { parseJson } from "../server/ai.js";

async function withServer(fn) {
  const db = openDb(":memory:");
  seed(db);
  const server = createApp(db).listen(0);
  const base = `http://localhost:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

test("CRUD on opportunities", () =>
  withServer(async (base) => {
    const list = await (await fetch(`${base}/api/opps`)).json();
    assert.equal(list.length, 6, "seed data loaded");

    const created = await (await fetch(`${base}/api/opps`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test lead", stage: "New", valueM: 1 }),
    })).json();
    assert.ok(created.id);

    const put = await fetch(`${base}/api/opps/${created.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...created, stage: "Qualified" }),
    });
    assert.equal((await put.json()).stage, "Qualified");

    assert.equal((await fetch(`${base}/api/opps/${created.id}`, { method: "DELETE" })).status, 204);
    assert.equal((await fetch(`${base}/api/opps/${created.id}`)).status, 404);
  }));

test("unknown collections and bad bodies are rejected", () =>
  withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/users`)).status, 404);
    const r = await fetch(`${base}/api/opps`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "[1,2]" });
    assert.equal(r.status, 400);
  }));

test("AI draft reports unavailable without an API key", () =>
  withServer(async (base) => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const r = await fetch(`${base}/api/ai/draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hi" }) });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).code, "ai_unavailable");
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  }));

test("parseJson tolerates fences and surrounding prose", () => {
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJson('Here you go:\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseJson('Sure. {"a":3} Done.'), { a: 3 });
  assert.equal(parseJson("no json"), null);
});
