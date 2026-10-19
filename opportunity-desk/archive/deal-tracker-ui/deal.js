// Screen 2: the deal card. A side panel on desktop, full screen on phones.
// Sections: header (inline edit) · latest update + next step · post an update · history · tasks · details.
import { STAGES, DEFAULT_DOMAINS, isDealOverdue, isDealStuck, lastActivity, daysSince } from "./deals.js";
import { WEIGHTS, THRESHOLDS, arr, clamp, lvl } from "./scoring.js";
import { WORKSTREAMS, TASK_STATUSES, normTasks, groupTasks, taskStats, isOverdue, newTaskId } from "./tasks.js";
import { api } from "./api.js";
import { state, refresh, showNotice, requireAuthor, changeStage, rawOf } from "./state.js";
import { $, esc, vc, vk, fmtDate, fmtDateTime, ago } from "./util.js";

// Panel-local state; reset every time a deal is opened.
let hist = null;        // update history, newest first (null = still loading)
let det = null;         // working copy of the Details fields (saved only on "Save details")
let detOpen = false, tasksOpen = false, drafted = false, aiText = "";
let taskEdit = null;    // null = task form closed, {} = adding, {id,...} = editing that task
let delArm = null, aiCtl = null;

const deal = () => state.opps.find((o) => o.id === state.openId);
const ro = () => (state.canWrite ? "" : "disabled");

export function openDeal(id) {
  state.openId = id; hist = null; det = null; detOpen = false; tasksOpen = false; drafted = false; aiText = ""; taskEdit = null; delArm = null;
  $("#panelRoot").innerHTML = `<div class="scrim" id="scrim"></div>
    <aside class="panel" id="dealPanel" role="dialog" aria-modal="true" aria-label="Deal card">
      <div id="pHead"></div>
      <div class="pbody"><section id="pLatest" class="latest"></section><section id="pUpdate"></section><section id="pHist"></section>
        <section id="pTasks"></section><section id="pDetails"></section><div id="pFoot" class="actions"></div></div></aside>`;
  document.body.classList.add("panel-open");
  $("#scrim").onclick = closeDeal;
  paintAll();
  $("#closeDeal")?.focus();
  loadHistory(id);
}

export function closeDeal() {
  const id = state.openId;
  aiCtl?.abort();
  state.openId = null;
  $("#panelRoot").innerHTML = "";
  document.body.classList.remove("panel-open");
  if (id) document.querySelector(`[data-open="${CSS.escape(id)}"]`)?.focus();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.openId) closeDeal(); });

async function loadHistory(id) {
  try { const h = await api.updates(id); if (state.openId !== id) return; hist = h; }
  catch (e) { if (state.openId !== id) return; hist = []; showNotice("Couldn't load this deal's history."); }
  paintLatest(); paintHist();
}

function paintAll() {
  const o = deal();
  if (!o) { closeDeal(); return; }
  if (!det) det = detFrom(o);
  paintHead(o); paintLatest(); paintUpdate(o); paintHist(); paintTasks(o); paintDetails(o); paintFoot(o);
}

/* ---------- header ---------- */
function paintHead(o) {
  $("#pHead").innerHTML = `<div class="phead">
    <div class="ptop"><span class="label">${esc(o.domain) || "Deal"}</span><button class="btn" id="closeDeal">Close ✕</button></div>
    <div class="field full"><label for="h-title">Title</label><input id="h-title" class="inl big" ${ro()} value="${esc(o.title)}"></div>
    <div class="hgrid">
      <div class="field"><label for="h-client">Client</label><input id="h-client" ${ro()} value="${esc(o.client)}"></div>
      <div class="field"><label for="h-stage">Stage</label><select id="h-stage" ${ro()}>${STAGES.map((s) => `<option${s === o.stage ? " selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="field"><label for="h-owner">Owner</label><input id="h-owner" ${ro()} value="${esc(o.owner)}"></div>
      <div class="field"><label for="h-value">Deal size ($M)</label><input id="h-value" type="number" min="0" step="0.1" ${ro()} value="${o.valueM}"></div>
    </div>
    <div class="hfoot"><span class="status" id="hStatus" role="status"></span><span id="hScore"></span></div></div>`;
  paintScore(o);
  $("#closeDeal").onclick = closeDeal;
  ["h-title", "h-client", "h-owner", "h-value"].forEach((id) => ($("#" + id).onchange = saveHead));
  $("#h-stage").onchange = async (e) => { if (await changeStage(o.id, e.target.value)) { await reloadHistory(); paintAll(); } else paintHead(deal() || o); };
}
function paintScore(o) {
  $("#hScore").innerHTML = `<span class="score-big num" style="color:var(--${vk(o.verdict)})">${o.score}</span> <span class="pill ${vc(o.verdict)}">${o.verdict}</span>`;
}
async function reloadHistory() { try { hist = await api.updates(state.openId); } catch (e) { /* keep what we have */ } }

async function saveHead() {
  const o = deal(), st = $("#hStatus");
  const v = (id) => $("#" + id).value.trim();
  const fail = (m, id, old) => { st.className = "status err"; st.textContent = m; $("#" + id).value = old; };
  if (!v("h-title")) return fail("A deal needs a title.", "h-title", o.title);
  if (!v("h-owner")) return fail("A deal needs an owner.", "h-owner", o.owner);
  st.className = "status"; st.textContent = "Saving…";
  try {
    await api.replace("opps", o.id, { ...rawOf(o), title: v("h-title"), client: v("h-client"), owner: v("h-owner"), valueM: clamp(parseFloat(v("h-value")) || 0, 0, 100000), updatedAt: new Date().toISOString() });
    await refresh();
    st.textContent = "Saved"; paintScore(deal());
  } catch (e) { st.className = "status err"; st.textContent = "Couldn't save: " + (e?.message || "try again."); }
}

/* ---------- latest update + next step ---------- */
function flagsHtml(o) {
  const stuck = isDealStuck(o) ? daysSince(lastActivity(o)) : null;
  return `${isDealOverdue(o) ? `<span class="flag f-od">Overdue</span>` : ""}${stuck !== null ? `<span class="flag f-st">Stuck · ${stuck}d</span>` : ""}`;
}
function paintLatest() {
  const o = deal(); if (!o) return;
  const u = hist?.[0];
  $("#pLatest").innerHTML = `<div class="chart-head"><span class="label">Latest update</span>
      <span class="sub" style="font-size:12px">${u ? `${esc(u.author)} · ${esc(ago(u.createdAt))}` : ""}</span></div>
    ${hist === null ? `<p class="sub">Loading…</p>` : u ? `<p class="ltext">${esc(u.text) || `<span class="sub">Next step changed.</span>`}</p>` : `<p class="sub">No updates yet. Post the first one below.</p>`}
    <div class="nextline"><span class="label">Next step</span>
      ${o.nextStep ? `<strong>${esc(o.nextStep)}</strong>` : `<span class="sub">None set</span>`}
      ${o.dueDate ? `<span class="num${isDealOverdue(o) ? " od" : ""}">Due ${esc(fmtDate(o.dueDate))}</span>` : ""}${flagsHtml(o)}</div>`;
}

/* ---------- post an update ---------- */
function paintUpdate(o) {
  if (!state.canWrite) { $("#pUpdate").innerHTML = ""; return; }
  $("#pUpdate").innerHTML = `<form class="upd" id="updForm" novalidate>
    <h3 class="sec">Post an update</h3>
    <div class="field"><label for="u-text">What happened</label><textarea id="u-text" class="prose" rows="3" placeholder="e.g. Met the CIO; they asked for a pilot proposal."></textarea></div>
    <div class="hgrid">
      <div class="field"><label for="u-next">Next step</label><input id="u-next" value="${esc(o.nextStep)}"></div>
      <div class="field"><label for="u-due">Due</label><input id="u-due" type="date" value="${esc(o.dueDate)}"></div></div>
    <div class="actions"><button class="btn primary" type="submit" id="postBtn">Post update</button>
      <span class="status" id="uStatus" role="status">${state.author ? `Posting as ${esc(state.author)}` : ""}</span></div></form>`;
  $("#updForm").onsubmit = postUpdate;
}
async function postUpdate(e) {
  e.preventDefault();
  const o = deal(), st = $("#uStatus"), btn = $("#postBtn");
  const text = $("#u-text").value.trim(), nextStep = $("#u-next").value.trim(), dueDate = $("#u-due").value;
  if (!text && nextStep === (o.nextStep || "") && dueDate === (o.dueDate || "")) {
    st.className = "status err"; st.textContent = "Say what happened, or change the next step or due date."; $("#u-text").focus(); return;
  }
  const author = requireAuthor(); if (!author) return;
  btn.disabled = true; st.className = "status"; st.textContent = "Posting…";
  try {
    await api.postUpdate(o.id, { author, text, nextStep, dueDate });
    await Promise.all([reloadHistory(), refresh()]);
    const fresh = deal();
    paintHead(fresh); paintLatest(); paintUpdate(fresh); paintHist();
    $("#uStatus").textContent = "Posted";
  } catch (err) { btn.disabled = false; st.className = "status err"; st.textContent = "Couldn't post: " + (err?.message || "try again."); }
}

/* ---------- history ---------- */
function paintHist() {
  const items = hist === null ? `<li class="sub">Loading…</li>`
    : hist.length ? hist.map((u) => `<li class="h-${esc(u.kind)}">
        <div class="hmeta"><strong>${esc(u.author)}</strong><span class="sub">${esc(fmtDateTime(u.createdAt))}</span>${u.kind === "stage" ? `<span class="tag">Stage</span>` : ""}</div>
        ${u.text ? `<p>${esc(u.text)}</p>` : ""}
        ${u.nextStep || u.dueDate ? `<p class="hnext"><span class="label">Next</span> ${esc(u.nextStep) || "—"}${u.dueDate ? ` · due ${esc(fmtDate(u.dueDate))}` : ""}</p>` : ""}</li>`).join("")
    : `<li class="sub">No history yet.</li>`;
  $("#pHist").innerHTML = `<h3 class="sec">History</h3><ol class="hist">${items}</ol>`;
}

/* ---------- tasks (collapsible) ---------- */
function paintTasks(o) {
  const tasks = normTasks(o.tasks), st = taskStats(tasks);
  const summary = st.total ? `${st.done} of ${st.total} done` + (st.overdue ? ` · <span class="od">${st.overdue} overdue</span>` : "") : "None yet";
  $("#pTasks").innerHTML = `<details class="fold" id="tasksD"${tasksOpen ? " open" : ""}>
    <summary><span class="sec">Tasks</span><span class="sub">${summary}</span></summary>
    <div class="tasks">${groupTasks(tasks).map((g) => `<div class="ws"><h4 class="ws-h">${esc(g.ws)} <span class="num">${g.tasks.filter((t) => t.status === "Done").length}/${g.tasks.length}</span></h4>
        <ul class="tlist">${g.tasks.map(taskRow).join("")}</ul></div>`).join("")}
      ${state.canWrite ? (taskEdit ? taskFormHtml() : `<div class="actions"><button class="btn" id="addTask">+ Add task</button></div>`) : ""}</div></details>`;
  bindTasks();
}
function taskRow(t) {
  const od = isOverdue(t);
  return `<li class="task${t.status === "Done" ? " done" : ""}">
    <div class="tmain"><span class="ttitle">${esc(t.t)}</span>
      <span class="tmeta"><span>${esc(t.owner) || "Unassigned"}</span><span class="num${od ? " od" : ""}">${t.due ? (od ? "Overdue · " : "Due ") + esc(fmtDate(t.due)) : "No due date"}</span></span></div>
    ${state.canWrite ? `<select class="tstatus s-${esc(t.status.replace(/\s/g, "").toLowerCase())}" data-tstatus="${esc(t.id)}" aria-label="Status of ${esc(t.t)}">${TASK_STATUSES.map((s) => `<option${s === t.status ? " selected" : ""}>${s}</option>`).join("")}</select>
      <span class="tbtns"><button class="linkbtn" data-tedit="${esc(t.id)}">Edit</button><button class="linkbtn danger" data-tdel="${esc(t.id)}">${delArm === t.id ? "Confirm?" : "Delete"}</button></span>`
      : `<span class="pill v-q">${esc(t.status)}</span>`}</li>`;
}
function taskFormHtml() {
  const t = taskEdit;
  return `<form class="tform" id="taskForm" novalidate>
    <div class="field"><label for="tk-ws">Workstream</label><select id="tk-ws">${WORKSTREAMS.map((w) => `<option${(t.ws || WORKSTREAMS[0]) === w ? " selected" : ""}>${w}</option>`).join("")}</select></div>
    <div class="field"><label for="tk-status">Status</label><select id="tk-status">${TASK_STATUSES.map((s) => `<option${(t.status || TASK_STATUSES[0]) === s ? " selected" : ""}>${s}</option>`).join("")}</select></div>
    <div class="field full"><label for="tk-t">Task</label><input id="tk-t" value="${esc(t.t)}" placeholder="e.g. Complete SIG-Lite questionnaire"></div>
    <div class="field"><label for="tk-owner">Owner</label><input id="tk-owner" value="${esc(t.owner)}"></div>
    <div class="field"><label for="tk-due">Due date</label><input id="tk-due" type="date" value="${esc(t.due)}"></div>
    <div class="field full"><div class="actions"><button class="btn primary" type="submit">${t.id ? "Save task" : "Add task"}</button><button class="btn" type="button" id="tkCancel">Cancel</button></div><div class="status err" id="tkStatus" role="status"></div></div></form>`;
}
// PUT replaces the record, so send the whole deal with the new task list.
async function saveTasks(tasks) {
  const o = deal();
  await api.replace("opps", o.id, { ...rawOf(o), tasks });
  await refresh();
}
function bindTasks() {
  const fail = (err) => { showNotice("Couldn't update tasks: " + (err?.message || "try again.")); paintTasks(deal()); };
  const tasks = () => normTasks(deal().tasks);
  const again = () => paintTasks(deal());
  $("#tasksD").ontoggle = (e) => { tasksOpen = e.target.open; };
  const add = $("#addTask"); if (add) add.onclick = () => { taskEdit = {}; again(); $("#tk-t")?.focus(); };
  const cancel = $("#tkCancel"); if (cancel) cancel.onclick = () => { taskEdit = null; again(); };
  document.querySelectorAll("[data-tstatus]").forEach((s) => (s.onchange = async () => {
    s.disabled = true;
    try { await saveTasks(tasks().map((t) => (t.id === s.dataset.tstatus ? { ...t, status: s.value } : t))); again(); } catch (e) { fail(e); }
  }));
  document.querySelectorAll("[data-tedit]").forEach((b) => (b.onclick = () => { taskEdit = tasks().find((t) => t.id === b.dataset.tedit) || null; again(); $("#tk-t")?.focus(); }));
  document.querySelectorAll("[data-tdel]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.tdel;
    if (delArm !== id) { delArm = id; again(); setTimeout(() => { if (delArm === id && state.openId) { delArm = null; again(); } }, 4000); return; }
    delArm = null; b.disabled = true;
    try { await saveTasks(tasks().filter((t) => t.id !== id)); again(); } catch (e) { fail(e); }
  }));
  const f = $("#taskForm"); if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const title = $("#tk-t").value.trim();
    if (!title) { $("#tkStatus").textContent = "Describe the task first."; $("#tk-t").focus(); return; }
    const t = { id: taskEdit.id || newTaskId(), ws: $("#tk-ws").value, t: title, owner: $("#tk-owner").value, due: $("#tk-due").value, status: $("#tk-status").value };
    const list = tasks(), next = taskEdit.id ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t];
    f.querySelector("button[type=submit]").disabled = true;
    try { await saveTasks(next); taskEdit = null; again(); }
    catch (err) { f.querySelector("button[type=submit]").disabled = false; $("#tkStatus").textContent = "Couldn't save: " + (err?.message || "try again."); }
  };
}

/* ---------- details (collapsible) ---------- */
const STANCES = ["Champion", "Neutral", "Blocker", "Unknown"];
const LEVELS = [["H", "High"], ["M", "Med"], ["L", "Low"]];
const ROWS = {
  products: { label: "Product fit", blank: { n: "", f: 70, note: "" }, cols: [
    { k: "n", ph: "Product", list: "prodList", grow: 2 }, { k: "f", ph: "Fit %", type: "number", min: 0, max: 100, w: 78 }, { k: "note", ph: "Why it fits", grow: 3 }] },
  stakeholders: { label: "Stakeholders", blank: { n: "", r: "", i: "M", s: "Unknown" }, cols: [
    { k: "n", ph: "Name or title", grow: 2 }, { k: "r", ph: "Role in decision", grow: 2 }, { k: "i", opts: LEVELS, label: "Influence", w: 96 }, { k: "s", opts: STANCES.map((s) => [s, s]), label: "Stance", w: 120 }] },
  risks: { label: "Risks", blank: { c: "", l: "M", note: "", m: "" }, cols: [
    { k: "c", ph: "Category", grow: 1 }, { k: "l", opts: LEVELS, label: "Level", w: 96 }, { k: "note", ph: "Detail", grow: 3 }, { k: "m", ph: "Mitigation", grow: 3 }] },
  strategic: { label: "Strategic value", str: true, cols: [{ k: "_", ph: "Why this deal matters", grow: 1 }] },
  gaps: { label: "Gaps needing custom work", str: true, cols: [{ k: "_", ph: "Capability we lack", grow: 1 }] },
};
const detFrom = (o) => ({
  domain: o.domain || "", timeline: o.timeline || "", source: o.source || "", valueScore: o.valueScore, need: o.need || "",
  products: o.products.map((p) => ({ ...p })), stakeholders: o.stakeholders.map((s) => ({ ...s })), risks: o.risks.map((r) => ({ ...r })),
  strategic: [...o.strategic], gaps: [...o.gaps],
});
const normStance = (s) => STANCES.find((x) => x.toLowerCase().startsWith(String(s || "").toLowerCase().slice(0, 2))) || "Unknown";

function cellHtml(c, val, name, i) {
  const common = `data-g="${name}" data-i="${i}" data-k="${c.k}" aria-label="${esc(c.label || c.ph)} (${esc(ROWS[name].label)} row ${i + 1})"`;
  const style = `style="flex:${c.grow ? `${c.grow} 1 130px` : `0 0 ${c.w}px`}"`;
  if (c.opts) return `<select ${common} ${style}>${c.opts.map(([v, l]) => `<option value="${v}"${v === val ? " selected" : ""}>${l}</option>`).join("")}</select>`;
  return `<input ${common} ${style} ${c.list ? `list="${c.list}"` : ""} ${c.type ? `type="${c.type}" min="${c.min}" max="${c.max}"` : ""} placeholder="${esc(c.ph)}" value="${esc(val)}">`;
}
function rowsHtml(name) {
  const spec = ROWS[name];
  return `<fieldset class="rows"><legend class="label">${spec.label}</legend>
    ${det[name].map((r, i) => `<div class="rrow" data-g="${name}" data-i="${i}">${spec.cols.map((c) => cellHtml(c, spec.str ? r : r[c.k], name, i)).join("")}
      <button type="button" class="linkbtn danger" data-rm="${name}:${i}" aria-label="Remove ${esc(spec.label)} row ${i + 1}">Remove</button></div>`).join("")}
    <button type="button" class="btn sm" data-add="${name}">+ Add</button></fieldset>`;
}
function dimHtml(name, val, hint, inverse) {
  const c = inverse ? (val >= 50 ? "var(--no)" : val >= 25 ? "var(--q)" : "var(--go)") : val >= 70 ? "var(--go)" : val >= 50 ? "var(--q)" : "var(--no)";
  return `<div class="dim"><div class="row"><span class="label">${name}</span><b style="color:${c}">${val}</b></div><span class="track"><i style="width:${val}%;background:${c}"></i></span><small>${hint}</small></div>`;
}

function paintDetails(o) {
  const domains = [...new Set([...DEFAULT_DOMAINS, ...state.opps.map((x) => x.domain).filter(Boolean)])];
  const pct = (w) => Math.round(w * 100);
  const part = (v, w) => Math.round(v * w * 10) / 10;
  $("#pDetails").innerHTML = `<details class="fold" id="detD"${detOpen ? " open" : ""}>
    <summary><span class="sec">Details</span><span class="sub">Need, products, stakeholders, risks, score</span></summary>
    <div class="details">
      ${state.canWrite ? `<div class="ai" aria-label="Draft with Claude">
        <div><span class="label" style="color:var(--accent)">Draft with Claude</span><p class="sub" style="margin-top:2px">Paste an RFP excerpt, client email or meeting notes. Claude fills in the fields below using your product catalog. Nothing is saved until you press “Save details”.</p></div>
        <textarea id="aiInput" placeholder="e.g. “The Authority invites proposals for an AI-based incident detection system…”">${esc(aiText)}</textarea>
        <div class="actions"><button class="btn primary" type="button" id="aiBtn"${state.aiAvailable ? "" : " disabled"}>Draft details</button><button class="btn" type="button" id="aiStop" hidden>Stop</button></div>
        <div class="status" id="aiStatus" role="status">${state.aiAvailable ? "" : "AI drafting is off on this server (no ANTHROPIC_API_KEY). You can still fill the fields by hand."}</div></div>` : ""}
      ${drafted ? `<p class="notice" role="status">Draft from Claude: review and edit the fields, then press “Save details”.</p>` : ""}
      <div class="form" id="detForm">
        <div class="field"><label for="d-domain">Domain</label><input id="d-domain" list="domainList" value="${esc(det.domain)}"><datalist id="domainList">${domains.map((d) => `<option value="${esc(d)}">`).join("")}</datalist></div>
        <div class="field"><label for="d-timeline">Timeline</label><input id="d-timeline" value="${esc(det.timeline)}" placeholder="Q1 2027 tender"></div>
        <div class="field"><label for="d-source">Source</label><input id="d-source" value="${esc(det.source)}" placeholder="Inbound RFI, partner referral…"></div>
        <div class="field"><label for="d-vs">Value score</label><div class="rangewrap"><input id="d-vs" type="range" min="0" max="100" value="${clamp(det.valueScore ?? 50, 0, 100)}"><output id="d-vsOut">${clamp(det.valueScore ?? 50, 0, 100)}</output></div><small>Deal size plus strategic weight, 0–100</small></div>
        <div class="field full"><label for="d-need">Client need</label><textarea id="d-need" class="prose">${esc(det.need)}</textarea></div>
      </div>
      <datalist id="prodList">${state.products.map((p) => `<option value="${esc(p.name)}">`).join("")}</datalist>
      ${["products", "stakeholders", "risks", "strategic", "gaps"].map(rowsHtml).join("")}
      <div class="breakdown"><span class="label">Score breakdown</span>
        <div class="dims">${dimHtml("Solution fit", o.fit, "Best product match")}${dimHtml("Value", o.valueScore, "Deal size + strategic weight")}${dimHtml("Risk", o.risk, "Sum of rated risks", true)}</div>
        <small class="sub">Score ${o.score} = ${part(o.fit, WEIGHTS.fit)} (${pct(WEIGHTS.fit)}% fit) + ${part(o.valueScore, WEIGHTS.value)} (${pct(WEIGHTS.value)}% value) + ${part(100 - o.risk, WEIGHTS.risk)} (${pct(WEIGHTS.risk)}% of 100 − risk). Go ≥ ${THRESHOLDS.go}, Qualify ${THRESHOLDS.qualify}–${THRESHOLDS.go - 1}, No-go below ${THRESHOLDS.qualify}.</small></div>
      ${state.canWrite ? `<div class="actions"><button class="btn primary" type="button" id="saveDet">Save details</button><span class="status" id="dStatus" role="status"></span></div>` : ""}
    </div></details>`;
  bindDetails();
}

function syncDet() {
  if (!$("#d-need")) return;
  det.domain = $("#d-domain").value; det.timeline = $("#d-timeline").value; det.source = $("#d-source").value;
  det.valueScore = +$("#d-vs").value; det.need = $("#d-need").value;
  for (const name of Object.keys(ROWS)) {
    det[name] = [...document.querySelectorAll(`.rrow[data-g="${name}"]`)].map((row) => {
      if (ROWS[name].str) return row.querySelector("input").value;
      const r = {}; row.querySelectorAll("[data-k]").forEach((i) => (r[i.dataset.k] = i.value)); return r;
    });
  }
  aiText = $("#aiInput")?.value ?? aiText;
}

function bindDetails() {
  $("#detD").ontoggle = (e) => { detOpen = e.target.open; };
  $("#d-vs").oninput = (e) => ($("#d-vsOut").textContent = e.target.value);
  document.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => {
    syncDet(); const name = b.dataset.add; det[name].push(ROWS[name].str ? "" : { ...ROWS[name].blank }); paintDetails(deal());
    document.querySelector(`.rrow[data-g="${name}"][data-i="${det[name].length - 1}"] input`)?.focus();
  }));
  document.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => {
    syncDet(); const [name, i] = b.dataset.rm.split(":"); det[name].splice(+i, 1); paintDetails(deal());
  }));
  const save = $("#saveDet"); if (save) save.onclick = saveDetails;
  if ($("#aiBtn")) bindAi();
}

async function saveDetails() {
  syncDet();
  const o = deal(), st = $("#dStatus"), btn = $("#saveDet");
  const strs = (l) => l.map((s) => String(s).trim()).filter(Boolean);
  const next = {
    ...rawOf(o), domain: det.domain.trim(), timeline: det.timeline.trim(), source: det.source.trim(), need: det.need.trim(),
    valueScore: clamp(det.valueScore, 0, 100), strategic: strs(det.strategic), gaps: strs(det.gaps),
    products: det.products.filter((p) => String(p.n).trim()).map((p) => ({ n: String(p.n).trim(), f: clamp(parseInt(p.f), 0, 100), note: String(p.note || "").trim() })),
    stakeholders: det.stakeholders.filter((s) => String(s.n).trim()).map((s) => ({ n: String(s.n).trim(), r: String(s.r || "").trim(), i: lvl(s.i), s: normStance(s.s) })),
    risks: det.risks.filter((r) => String(r.c).trim() || String(r.note).trim()).map((r) => ({ c: String(r.c).trim() || "Risk", l: lvl(r.l), note: String(r.note || "").trim(), m: String(r.m || "").trim() })),
    updatedAt: new Date().toISOString(),
  };
  btn.disabled = true; st.className = "status"; st.textContent = "Saving…";
  try {
    await api.replace("opps", o.id, next);
    await refresh();
    const fresh = deal(); drafted = false; det = detFrom(fresh);
    paintHead(fresh); paintDetails(fresh);
    $("#dStatus").textContent = "Saved";
  } catch (e) { btn.disabled = false; st.className = "status err"; st.textContent = "Couldn't save: " + (e?.message || "try again."); }
}

/* ---------- draft with Claude ---------- */
const AI_ERR = { ai_unavailable: "AI drafting is off on this server. Add ANTHROPIC_API_KEY to .env, or fill the fields by hand.", rate_limited: "Too many requests just now. Try again in a minute.", refused: "Claude declined this text. Try a shorter or different excerpt.", invalid_json: "Claude's answer couldn't be read. Try again.", prompt_too_large: "That text is too long. Paste a shorter excerpt.", session_expired: "Sign in to Claude again, then retry." };
function bindAi() {
  const btn = $("#aiBtn"), stop = $("#aiStop"), st = $("#aiStatus");
  stop.onclick = () => aiCtl?.abort();
  btn.onclick = async () => {
    const text = $("#aiInput").value.trim();
    if (!text) { st.className = "status err"; st.textContent = "Paste some text first."; return; }
    aiCtl = new AbortController(); btn.disabled = true; stop.hidden = false; st.className = "status"; st.textContent = "Thinking… this can take up to a minute.";
    try {
      const r = await api.draft(text, aiCtl.signal);
      if (!r || typeof r !== "object") throw { code: "invalid_json" };
      if (!state.openId) return;
      syncDet();
      const s = (v) => String(v ?? "").trim();
      if (s(r.domain)) det.domain = s(r.domain);
      if (s(r.timeline)) det.timeline = s(r.timeline);
      if (s(r.source)) det.source = s(r.source);
      if (s(r.need)) det.need = s(r.need);
      if (Number.isFinite(+r.valueScore) && r.valueScore !== null) det.valueScore = clamp(r.valueScore, 0, 100);
      if (arr(r.products).length) det.products = arr(r.products).map((p) => ({ n: s(p.n), f: clamp(p.f, 0, 100), note: s(p.note) })).filter((p) => p.n);
      if (arr(r.stakeholders).length) det.stakeholders = arr(r.stakeholders).map((x) => ({ n: s(x.n), r: s(x.r), i: lvl(x.i), s: normStance(x.s) })).filter((x) => x.n);
      if (arr(r.risks).length) det.risks = arr(r.risks).map((x) => ({ c: s(x.c) || "Risk", l: lvl(x.l), note: s(x.note), m: s(x.m) }));
      if (arr(r.gaps).length) det.gaps = arr(r.gaps).map(s).filter(Boolean);
      if (arr(r.strategic).length) det.strategic = arr(r.strategic).map(s).filter(Boolean);
      drafted = true; aiText = text; paintDetails(deal());
      $("#aiStatus").textContent = "Draft ready. Review the fields, adjust scores, then save.";
    } catch (e) {
      if (e?.name === "AbortError") st.textContent = "Stopped.";
      else { st.className = "status err"; st.textContent = AI_ERR[e?.code] || "Something went wrong. Try again."; }
    } finally { const b = $("#aiBtn"), x = $("#aiStop"); if (b) b.disabled = !state.aiAvailable; if (x) x.hidden = true; }
  };
}

/* ---------- footer ---------- */
function paintFoot(o) {
  $("#pFoot").innerHTML = state.canWrite ? `<button class="btn danger" id="delBtn">${delArm === o.id ? "Tap again to delete" : "Delete deal"}</button>` : "";
  const d = $("#delBtn"); if (!d) return;
  d.onclick = async () => {
    if (delArm !== o.id) { delArm = o.id; paintFoot(o); setTimeout(() => { if (delArm === o.id && state.openId === o.id) { delArm = null; paintFoot(o); } }, 4000); return; }
    delArm = null; d.disabled = true;
    try { await api.remove("opps", o.id); closeDeal(); await refresh(); }
    catch (err) { showNotice("Couldn't delete: " + (err?.message || "try again.")); paintFoot(o); }
  };
}
