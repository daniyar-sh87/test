// Screen 1: the Board. Kanban columns by stage; drag a card (or use its stage dropdown) to change stage.
import { STAGES, isDealOverdue, isDealStuck, summarize, lastActivity, daysSince } from "./deals.js";
import { state, setScope, changeStage } from "./state.js";
import { openDeal } from "./deal.js";
import { $, esc, vc, money, norm, fmtDate } from "./util.js";

const mine = (o) => !!state.author && norm(o.owner) === norm(state.author);

// Most urgent first: earliest due date (undated last), then bigger deals.
const byUrgency = (a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || b.valueM - a.valueM;

export function renderBoard() {
  const el = $("#view");
  if (!state.dbReady) { el.innerHTML = `<div class="card empty"><strong>Loading deals…</strong></div>`; return; }

  const domains = ["All", ...new Set(state.opps.map((o) => o.domain).filter(Boolean))];
  if (!domains.includes(state.domain)) state.domain = "All";
  const visible = state.opps.filter((o) => (state.scope === "all" || mine(o)) && (state.domain === "All" || o.domain === state.domain));
  const sum = summarize(visible);
  const needName = state.scope === "mine" && !state.author;

  el.innerHTML = `<div class="col">
    <div class="bar">
      <div class="seg" role="group" aria-label="Whose deals">
        <button id="s-mine" data-scope="mine" aria-pressed="${state.scope === "mine"}">My deals</button>
        <button id="s-all" data-scope="all" aria-pressed="${state.scope === "all"}">All</button></div>
      <label class="dsel"><span class="label">Domain</span>
        <select id="domainSel">${domains.map((d) => `<option${d === state.domain ? " selected" : ""}>${esc(d)}</option>`).join("")}</select></label>
      <p class="sumline" aria-live="polite"><strong class="num">${money(sum.value)}</strong> open pipeline
        · <span class="num${sum.overdue ? " od" : ""}">${sum.overdue}</span> overdue
        · <span class="num${sum.stuck ? " st" : ""}">${sum.stuck}</span> stuck</p>
    </div>
    ${needName ? `<p class="notice">Enter your name in the top bar to see your deals.</p>` : ""}
    ${state.opps.length ? "" : `<div class="card empty"><strong>No deals yet</strong><span>Add your first one: it takes a title, client, owner and deal size.</span>${state.canWrite ? `<button class="btn primary" id="emptyNew">+ New deal</button>` : ""}</div>`}
    <div class="board" role="list" aria-label="Deals by stage">
      ${STAGES.map((st) => columnHtml(st, visible.filter((o) => o.stage === st).sort(byUrgency))).join("")}
    </div></div>`;
  bindBoard(el);
}

function columnHtml(st, deals) {
  const collapsed = !!state.collapsed[st];
  const value = deals.reduce((s, o) => s + o.valueM, 0);
  const closed = st === "Won" || st === "Lost"; // only these can be collapsed
  const head = `<span class="sname">${st}</span><span class="scount num">${deals.length}</span><span class="sval num">${money(value)}</span>`;
  return `<section class="stage${collapsed ? " collapsed" : ""}" role="listitem" data-stage="${st}" aria-label="${st}, ${deals.length} deals">
    ${closed ? `<button class="shead" data-toggle="${st}" aria-expanded="${!collapsed}">${head}<span class="chev" aria-hidden="true">${collapsed ? "▸" : "▾"}</span></button>`
             : `<div class="shead">${head}</div>`}
    ${collapsed ? "" : `<div class="cards">${deals.length ? deals.map(cardHtml).join("") : `<p class="sub empty-col">No deals</p>`}</div>`}
  </section>`;
}

function cardHtml(o) {
  const overdue = isDealOverdue(o), stuckDays = isDealStuck(o) ? daysSince(lastActivity(o)) : null;
  return `<article class="deal" draggable="${state.canWrite}" data-id="${esc(o.id)}" aria-label="${esc(o.title)}">
    <div class="dtop"><button class="dtitle" data-open="${esc(o.id)}">${esc(o.title)}</button><span class="pill ${vc(o.verdict)}" title="Opportunity score ${o.score}">${o.verdict}</span></div>
    <p class="dmeta">${esc(o.client) || "No client"} · <span class="num">${money(o.valueM)}</span> · ${esc(o.owner) || "No owner"}</p>
    <p class="dnext">${o.nextStep
      ? `<span class="label">Next</span> ${esc(o.nextStep)}${o.dueDate ? ` <span class="num ddue${overdue ? " od" : ""}">· ${esc(fmtDate(o.dueDate))}</span>` : ""}`
      : `<span class="label">Next</span> <span class="sub">No next step set</span>`}</p>
    ${overdue || stuckDays !== null ? `<div class="flags">${overdue ? `<span class="flag f-od">Overdue</span>` : ""}${stuckDays !== null ? `<span class="flag f-st">Stuck · ${stuckDays}d</span>` : ""}</div>` : ""}
    ${state.canWrite ? `<select class="dstage" data-stage-of="${esc(o.id)}" aria-label="Stage of ${esc(o.title)}">${STAGES.map((s) => `<option${s === o.stage ? " selected" : ""}>${s}</option>`).join("")}</select>` : ""}
  </article>`;
}

function bindBoard(el) {
  el.querySelectorAll("[data-scope]").forEach((b) => (b.onclick = () => { setScope(b.dataset.scope); state.render(); }));
  $("#domainSel").onchange = (e) => { state.domain = e.target.value; state.render(); };
  el.querySelectorAll("[data-toggle]").forEach((b) => (b.onclick = () => { state.collapsed[b.dataset.toggle] = !state.collapsed[b.dataset.toggle]; state.render(); }));
  const en = $("#emptyNew"); if (en) en.onclick = () => $("#newBtn").click();

  el.querySelectorAll(".deal").forEach((card) => {
    const id = card.dataset.id;
    card.onclick = (e) => { if (!e.target.closest("select")) openDeal(id); };
    card.onkeydown = (e) => { if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDeal(id); } };
    card.tabIndex = 0;
    card.ondragstart = (e) => { state.dragging = true; e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; card.classList.add("dragging"); };
    card.ondragend = () => { state.dragging = false; card.classList.remove("dragging"); el.querySelectorAll(".over").forEach((s) => s.classList.remove("over")); };
  });
  el.querySelectorAll("[data-stage-of]").forEach((s) => (s.onchange = () => changeStage(s.dataset.stageOf, s.value)));

  el.querySelectorAll(".stage").forEach((col) => {
    col.ondragover = (e) => { if (!state.dragging) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; col.classList.add("over"); };
    col.ondragleave = (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("over"); };
    col.ondrop = (e) => {
      e.preventDefault(); col.classList.remove("over"); state.dragging = false;
      const id = e.dataTransfer.getData("text/plain");
      if (id) changeStage(id, col.dataset.stage);
    };
  });
}
