// Per-opportunity tasks, grouped by workstream. Shared by the browser (app.js) and the tests.
// A task is { id, ws, t, owner, due: "YYYY-MM-DD" | "", status }.

export const WORKSTREAMS = ["Solution design", "Demo", "Proposal", "Pricing", "Security questionnaire"];
export const TASK_STATUSES = ["To do", "In progress", "Blocked", "Done"];

const arr = (v) => (Array.isArray(v) ? v : []);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Case-insensitive match against a fixed list; anything unknown falls back to `fallback`.
const pick = (v, list, fallback) => list.find((x) => x.toLowerCase() === String(v || "").trim().toLowerCase()) || fallback;

export function newTaskId() {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Normalise stored tasks; drops entries without a title.
export function normTasks(list) {
  return arr(list)
    .map((x) => ({
      id: String(x?.id || newTaskId()),
      ws: pick(x?.ws, WORKSTREAMS, WORKSTREAMS[0]),
      t: String(x?.t || "").trim(),
      owner: String(x?.owner || "").trim(),
      due: DATE.test(String(x?.due || "")) ? x.due : "",
      status: pick(x?.status, TASK_STATUSES, TASK_STATUSES[0]),
    }))
    .filter((x) => x.t);
}

// Local-time YYYY-MM-DD, so "today" matches what the user sees on their calendar.
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const isOverdue = (task, today = todayStr()) => task.status !== "Done" && !!task.due && task.due < today;

// Groups in the fixed workstream order; empty workstreams are omitted.
// Within a group: open tasks first, by due date (undated last), then done.
export function groupTasks(tasks) {
  const rank = (t) => (t.status === "Done" ? 1 : 0);
  const byDue = (a, b) => rank(a) - rank(b) || (a.due || "9999").localeCompare(b.due || "9999");
  return WORKSTREAMS.map((ws) => ({ ws, tasks: tasks.filter((t) => t.ws === ws).sort(byDue) })).filter((g) => g.tasks.length);
}

// A deal's next action is one of its tasks: the open task to work on next. Done tasks are skipped,
// tasks that aren't Blocked come first (a blocked task can't be acted on), then the earliest due
// date wins (undated last), then list order. Returns null when no task is open.
export function nextAction(tasks) {
  const open = arr(tasks).filter((t) => t.status !== "Done");
  const ready = open.filter((t) => t.status !== "Blocked");
  const pool = ready.length ? ready : open;
  return [...pool].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"))[0] || null;
}

export function taskStats(tasks, today = todayStr()) {
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.status === "Done").length,
    blocked: tasks.filter((t) => t.status === "Blocked").length,
    overdue: tasks.filter((t) => isOverdue(t, today)).length,
  };
}
