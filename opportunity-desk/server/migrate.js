// Startup migration to the deal-tracker model. Safe to run any number of times:
//  - stage Discovery -> New
//  - `next` -> `nextStep` (only when nextStep isn't set yet), `dueDate` defaults to ""
//  - each `status` becomes the deal's first update (fixed id, so it's inserted once)
//  - `lastActivityAt` is set from statusAt / updatedAt / createdAt when missing
// Old fields (status, statusAt, next) are left in place so nothing is lost.
import { migrateStage } from "../public/deals.js";

export function migrate(db) {
  const rows = db.prepare("SELECT id, data, created_at FROM opps").all();
  const setData = db.prepare("UPDATE opps SET data = ? WHERE id = ?"); // keeps updated_at untouched
  const addUpdate = db.prepare(
    `INSERT OR IGNORE INTO updates (id, opp_id, author, kind, text, next_step, due_date, created_at)
     VALUES (?, ?, 'Imported', 'note', ?, '', '', ?)`,
  );
  const result = { stages: 0, updates: 0, deals: 0 };

  db.transaction(() => {
    for (const r of rows) {
      const o = JSON.parse(r.data);
      let changed = false;

      const stage = migrateStage(o.stage);
      if (stage !== o.stage) { o.stage = stage; changed = true; result.stages++; }

      if (o.nextStep === undefined) { o.nextStep = String(o.next || ""); changed = true; }
      if (o.dueDate === undefined) { o.dueDate = ""; changed = true; }

      const status = String(o.status || "").trim();
      if (status) {
        const at = o.statusAt || o.updatedAt || o.createdAt || r.created_at;
        if (addUpdate.run(`mig-${r.id}`, r.id, status, at).changes) result.updates++;
      }

      if (!o.lastActivityAt) { o.lastActivityAt = o.statusAt || o.updatedAt || o.createdAt || r.created_at; changed = true; }

      if (changed) { setData.run(JSON.stringify(o), r.id); result.deals++; }
    }
  })();
  return result;
}
