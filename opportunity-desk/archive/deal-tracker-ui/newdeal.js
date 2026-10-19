// New deal form: five required fields, plus an optional first next step and due date.
// Everything else is added later on the deal card.
import { STAGES } from "./deals.js";
import { api } from "./api.js";
import { state, refresh } from "./state.js";
import { openDeal } from "./deal.js";
import { $, esc } from "./util.js";

export function renderNewDeal() {
  $("#view").innerHTML = `<div class="col narrow">
    <div class="chart-head"><h2 style="font-size:22px">New deal</h2><button class="btn" id="cancelBtn">Cancel</button></div>
    <form class="card form" id="dealForm" novalidate>
      <div class="field full"><label for="n-title">Title <span class="req">required</span></label><input id="n-title" required placeholder="Citywide traffic incident detection"></div>
      <div class="field"><label for="n-client">Client <span class="req">required</span></label><input id="n-client" required></div>
      <div class="field"><label for="n-owner">Owner <span class="req">required</span></label><input id="n-owner" required value="${esc(state.author)}"></div>
      <div class="field"><label for="n-stage">Stage</label><select id="n-stage">${STAGES.map((s) => `<option${s === "New" ? " selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="field"><label for="n-value">Deal size ($M) <span class="req">required</span></label><input id="n-value" type="number" min="0" step="0.1" required></div>
      <div class="field"><label for="n-next">First next step</label><input id="n-next" placeholder="e.g. Book discovery call"></div>
      <div class="field"><label for="n-due">Due</label><input id="n-due" type="date"></div>
      <div class="field full"><div class="actions"><button class="btn primary" type="submit" id="saveBtn">Create deal</button></div><div class="status" id="saveStatus" role="status"></div></div>
    </form>
    <p class="sub">Domain, products, stakeholders, risks and the rest can be added later on the deal card.</p></div>`;
  $("#cancelBtn").onclick = () => { state.view = "board"; state.render(); };
  $("#dealForm").onsubmit = saveDeal;
  $("#n-title").focus();
}

async function saveDeal(e) {
  e.preventDefault();
  const st = $("#saveStatus"), btn = $("#saveBtn");
  const v = (id) => $("#" + id).value.trim();
  const missing = [["n-title", "a title"], ["n-client", "a client"], ["n-owner", "an owner"], ["n-value", "a deal size"]].find(([id]) => !v(id));
  if (missing) { st.className = "status err"; st.textContent = `Add ${missing[1]} before saving.`; $("#" + missing[0]).focus(); return; }
  const valueM = parseFloat(v("n-value"));
  if (!(valueM >= 0)) { st.className = "status err"; st.textContent = "Deal size must be a number, 0 or more."; $("#n-value").focus(); return; }

  btn.disabled = true; st.className = "status"; st.textContent = "Saving…";
  const now = new Date().toISOString();
  try {
    const doc = await api.create("opps", {
      title: v("n-title"), client: v("n-client"), owner: v("n-owner"), stage: v("n-stage"), valueM,
      valueScore: 50, nextStep: v("n-next"), dueDate: $("#n-due").value, createdAt: now, updatedAt: now, lastActivityAt: now,
    });
    // First history entry, signed by whoever is using this browser (or the owner if no name is set yet).
    await api.postUpdate(doc.id, { author: state.author || v("n-owner"), text: "Deal created", nextStep: v("n-next"), dueDate: $("#n-due").value });
    state.view = "board"; state.openId = null;
    await refresh();
    openDeal(doc.id);
    window.scrollTo({ top: 0 });
  } catch (err) {
    btn.disabled = false; st.className = "status err"; st.textContent = "Couldn't save: " + (err?.message || "try again.");
  }
}
