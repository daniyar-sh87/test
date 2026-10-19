// Shared UI state and the actions every screen needs (refresh, notices, author, stage change).
import { derive } from "./scoring.js";
import { api } from "./api.js";
import { $ } from "./util.js";

const read = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode: just don't remember */ } };

export const state = {
  opps: [], products: [], aiAvailable: false, canWrite: true, dbReady: false,
  view: "board",            // board | settings | new
  openId: null,             // deal shown in the side panel
  scope: read("od-scope") === "mine" ? "mine" : "all",
  domain: "All",
  collapsed: { Won: true, Lost: true }, // board columns that show only their header
  author: read("od-author"),
  dragging: false,
  render: () => {},         // set by app.js
};

export function setScope(v) { state.scope = v; write("od-scope", v); }
export function setAuthor(v) { state.author = String(v || "").trim(); write("od-author", state.author); }

export function showNotice(t) { const n = $("#notice"); n.textContent = t || ""; n.hidden = !t; }

export async function refresh() {
  const [o, p] = await Promise.all([api.list("opps"), api.list("products")]);
  state.opps = o.map(derive);
  state.products = p.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  state.dbReady = true;
  showNotice("");
  state.render();
}

// Updates are signed with the name kept in this browser (there is no login yet).
export function requireAuthor() {
  if (state.author) return state.author;
  showNotice("Enter your name in the top bar first. It is recorded on updates and used for “My deals”.");
  $("#who")?.focus();
  return "";
}

// Move a deal to another stage; the server adds the "Stage: A → B" history entry.
export async function changeStage(id, to) {
  const o = state.opps.find((x) => x.id === id);
  if (!o || o.stage === to) return false;
  const author = requireAuthor();
  if (!author) { state.render(); return false; }
  try {
    await api.postUpdate(id, { author, stage: to });
    await refresh();
    return true;
  } catch (e) {
    showNotice("Couldn't change the stage: " + (e?.message || "try again."));
    state.render();
    return false;
  }
}

// A stored record without the fields derive() computes, ready to PUT back.
export function rawOf(o) {
  const { fit, risk, score, verdict, id, ...raw } = o;
  return raw;
}
