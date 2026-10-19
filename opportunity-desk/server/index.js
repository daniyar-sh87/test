import "dotenv/config";
import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, seed, list, get, create, replace, remove, listUpdates, addUpdate, COLLECTIONS } from "./db.js";
import { aiEnabled, draftAssessment, draftStatus, AiError } from "./ai.js";

export function createApp(db) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const coll = (req, res, next) => (COLLECTIONS.includes(req.params.coll) ? next() : res.status(404).json({ error: "Unknown collection" }));
  const body = (req, res, next) =>
    req.body && typeof req.body === "object" && !Array.isArray(req.body) ? next() : res.status(400).json({ error: "Body must be a JSON object" });

  app.get("/api/config", (_req, res) => res.json({ ai: aiEnabled() }));

  app.post("/api/ai/draft", async (req, res) => {
    try {
      const draft = await draftAssessment(String(req.body?.text || ""), list(db, "products"));
      res.json(draft);
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError("upstream_error", 500);
      res.status(err.status).json({ code: err.code, error: err.message });
    }
  });

  // Suggest a latest status from the deal's saved task statuses. Returns text only; the client
  // reviews it and saves it (marked as AI-generated) with a normal PUT.
  app.post("/api/ai/status", async (req, res) => {
    const opp = get(db, "opps", String(req.body?.id || ""));
    if (!opp) return res.status(404).json({ code: "not_found", error: "Not found" });
    try {
      res.json({ text: await draftStatus(opp) });
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError("upstream_error", 500);
      res.status(err.status).json({ code: err.code, error: err.message });
    }
  });

  // Deal history. Registered before the generic /api/:coll routes.
  app.get("/api/opps/:id/updates", (req, res) => {
    const updates = listUpdates(db, req.params.id);
    updates ? res.json(updates) : res.status(404).json({ error: "Not found" });
  });
  app.post("/api/opps/:id/updates", body, (req, res) => {
    try {
      res.status(201).json(addUpdate(db, req.params.id, req.body));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.status ? e.message : "Couldn't save the update." });
    }
  });

  app.get("/api/:coll", coll, (req, res) => res.json(list(db, req.params.coll)));
  app.get("/api/:coll/:id", coll, (req, res) => {
    const doc = get(db, req.params.coll, req.params.id);
    doc ? res.json(doc) : res.status(404).json({ error: "Not found" });
  });
  app.post("/api/:coll", coll, body, (req, res) => res.status(201).json(create(db, req.params.coll, req.body)));
  app.put("/api/:coll/:id", coll, body, (req, res) => {
    const doc = replace(db, req.params.coll, req.params.id, req.body);
    doc ? res.json(doc) : res.status(404).json({ error: "Not found" });
  });
  app.delete("/api/:coll/:id", coll, (req, res) => {
    remove(db, req.params.coll, req.params.id) ? res.status(204).end() : res.status(404).json({ error: "Not found" });
  });

  app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), "..", "public")));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  const seeded = seed(db);
  if (seeded.opps || seeded.products) console.log(`Seeded ${seeded.opps} opportunities and ${seeded.products} products.`);
  const port = Number(process.env.PORT) || 3000;
  createApp(db).listen(port, () => {
    console.log(`Opportunity Desk running at http://localhost:${port}`);
    if (!aiEnabled()) console.log("AI drafting is off. Add ANTHROPIC_API_KEY to .env to turn it on.");
  });
}
