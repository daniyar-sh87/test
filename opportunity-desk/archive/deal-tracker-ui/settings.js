// Settings: the product catalog that "Draft with Claude" matches against.
import { api } from "./api.js";
import { state, refresh, showNotice } from "./state.js";
import { $, esc, money, norm } from "./util.js";

let delArm = null;

export function renderSettings() {
  const el = $("#view");
  if (!state.dbReady) { el.innerHTML = `<div class="card empty"><strong>Loading…</strong></div>`; return; }
  const stats = (p) => {
    const os = state.opps.filter((o) => o.products.some((x) => norm(x.n) === norm(p.name) && x.f >= 60));
    return { n: os.length, v: os.reduce((s, o) => s + o.valueM, 0) };
  };
  el.innerHTML = `<div class="col">
   <div><h2 style="font-size:22px">Settings</h2><h3 class="sec" style="margin-top:14px">Product catalog</h3>
     <p class="sub">Claude matches deals against this list, so keep names and descriptions accurate.</p></div>
   ${state.products.length ? `<div class="grid2">${state.products.map((p) => { const s = stats(p); return `<div class="card prod"><div class="chart-head"><h3>${esc(p.name)}</h3>${p.example ? `<span class="ex">example</span>` : ""}</div>
     <p style="margin:0">${esc(p.desc) || "<span class='sub'>No description</span>"}</p>
     ${(p.domains || []).length ? `<div class="tags">${p.domains.map((d) => `<span class="tag">${esc(d)}</span>`).join("")}</div>` : ""}
     <div class="figs sub num" style="font-size:13px">${s.n} strong-fit deals · ${money(s.v)}</div>
     ${state.canWrite ? `<div class="actions"><button class="btn danger" data-del="${esc(p.id)}">${delArm === p.id ? "Tap again to remove" : "Remove"}</button></div>` : ""}</div>`; }).join("")}</div>`
     : `<div class="card empty"><strong>No products yet</strong><span>Add your products so Claude can score solution fit.</span></div>`}
   ${state.canWrite ? `<form class="card form" id="prodForm" novalidate>
     <div class="field full"><h2 style="font-size:18px">Add a product</h2></div>
     <div class="field"><label for="p-name">Name</label><input id="p-name"></div>
     <div class="field"><label for="p-domains">Domains</label><input id="p-domains" placeholder="Smart City, Energy"><small>Comma-separated</small></div>
     <div class="field full"><label for="p-desc">What it does</label><textarea id="p-desc" class="prose" placeholder="One or two sentences on capabilities"></textarea></div>
     <div class="field full"><div class="actions"><button class="btn primary" type="submit">Add product</button></div><div class="status" id="pStatus" role="status"></div></div>
   </form>` : ""}</div>`;
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.del;
    if (delArm !== id) { delArm = id; renderSettings(); setTimeout(() => { if (delArm === id) { delArm = null; if (state.view === "settings") renderSettings(); } }, 4000); return; }
    delArm = null; b.disabled = true;
    try { await api.remove("products", id); await refresh(); } catch (e) { showNotice("Couldn't remove the product. Try again."); }
  }));
  const f = $("#prodForm");
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const st = $("#pStatus"), name = $("#p-name").value.trim();
    if (!name) { st.className = "status err"; st.textContent = "Add a product name."; return; }
    try {
      await api.create("products", { name, desc: $("#p-desc").value.trim(), domains: $("#p-domains").value.split(",").map((s) => s.trim()).filter(Boolean), createdAt: new Date().toISOString() });
      await refresh();
    } catch (err) { st.className = "status err"; st.textContent = "Couldn't add the product. Try again."; }
  };
}
