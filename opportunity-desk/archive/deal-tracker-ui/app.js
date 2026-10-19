// App shell: navigation, the "who am I" name box, boot and background refresh.
// Screens live in board.js, deal.js, newdeal.js and settings.js.
import { call } from "./api.js";
import { state, refresh, showNotice, setAuthor } from "./state.js";
import { renderBoard } from "./board.js";
import { renderNewDeal } from "./newdeal.js";
import { renderSettings } from "./settings.js";
import { $ } from "./util.js";

function render() {
  document.querySelectorAll(".navbtn").forEach((b) => b.setAttribute("aria-current", b.dataset.v === state.view ? "page" : "false"));
  $("#newBtn").hidden = !state.canWrite || state.view === "new";
  if (state.view === "board") renderBoard();
  else if (state.view === "settings") renderSettings();
  else renderNewDeal();
}
state.render = render;

document.querySelectorAll(".navbtn").forEach((b) => (b.onclick = () => { state.view = b.dataset.v; render(); }));
$("#newBtn").onclick = () => { state.view = "new"; render(); window.scrollTo({ top: 0 }); };

const who = $("#who");
who.value = state.author;
who.onchange = () => { setAuthor(who.value); showNotice(""); render(); };

/* ---------- boot ---------- */
render();
(async () => {
  try { state.aiAvailable = !!(await call("GET", "/api/config")).ai; } catch (e) { /* AI stays off */ }
  try { await refresh(); }
  catch (e) { state.dbReady = true; showNotice("Can't reach the server. Is it running? Reload to try again."); render(); return; }
  // Pick up teammates' changes while the tab is open, without disturbing typing or a drag in progress.
  setInterval(() => {
    const a = document.activeElement;
    const typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest("#view");
    if (document.visibilityState !== "visible" || state.view === "new" || state.dragging || typing) return;
    refresh().catch(() => showNotice("Lost connection to the server."));
  }, 20000);
})();
