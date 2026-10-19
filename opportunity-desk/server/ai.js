// AI drafting: turns pasted RFP / email text into a structured assessment.
// Runs server-side so the API key never reaches the browser.
import Anthropic from "@anthropic-ai/sdk";

import { DEFAULT_DOMAINS } from "../public/deals.js";
import { normTasks, groupTasks, isOverdue, todayStr } from "../public/tasks.js";
export { DEFAULT_DOMAINS };
const MAX_INPUT = 30000;

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function buildPrompt(text, products) {
  const catalog = products.length
    ? products.map((p) => `- ${p.name}: ${p.desc || ""}${p.domains?.length ? ` (domains: ${p.domains.join(", ")})` : ""}`).join("\n")
    : "- (no products in catalog)";
  return `You are a presales solution architect qualifying a sales opportunity.
Our product catalog (match ONLY against these exact product names):
${catalog}

Known domains: ${DEFAULT_DOMAINS.join(", ")} (use one of these or a short new one).

Read the client text below and reply with ONLY one JSON object in this exact shape:
{"title":"short opportunity title","client":"client name or ''","domain":"","source":"e.g. RFP, email, meeting","valueM":number or null (deal size in USD millions, estimate only if text gives a clue),"timeline":"","need":"1-2 sentence client need","valueScore":0-100 (deal size + strategic weight),"products":[{"n":"exact catalog name","f":0-100 fit,"note":"why, one line"}],"gaps":["capability we lack, short"],"strategic":["strategic upside, short"],"stakeholders":[{"n":"name or title","r":"role in decision","i":"H|M|L","s":"Champion|Neutral|Blocker|Unknown"}],"risks":[{"c":"category","l":"H|M|L","note":"detail","m":"mitigation"}],"next":"one concrete next action"}
Include 1-4 products sorted by fit, 2-5 risks, and stakeholders implied by the text. Be realistic and concise.

CLIENT TEXT:
"""${text}"""`;
}

// Tolerant JSON extraction: whole reply, a fenced block, or first { to last }.
export function parseJson(reply) {
  const tries = [reply, reply.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1)];
  for (const t of tries) {
    if (!t) continue;
    try { const v = JSON.parse(t); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch { /* next */ }
  }
  return null;
}

export class AiError extends Error {
  constructor(code, status, message) { super(message || code); this.code = code; this.status = status; }
}

let client;
export function setClient(c) { client = c; } // tests inject a fake

// One Messages API call; maps SDK failures to AiError. Returns the reply text.
async function ask(prompt, maxTokens) {
  client ??= new Anthropic();
  let msg;
  try {
    msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (e) {
    if (e?.status === 429) throw new AiError("rate_limited", 429, "Too many requests just now. Try again in a minute.");
    if (e?.status === 401) throw new AiError("ai_unavailable", 503, "The Anthropic API key was rejected.");
    throw new AiError("upstream_error", 502, "The AI service didn't respond. Try again.");
  }
  return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

export async function draftAssessment(text, products) {
  if (!aiEnabled()) throw new AiError("ai_unavailable", 503, "Set ANTHROPIC_API_KEY to enable AI drafting.");
  if (!text?.trim()) throw new AiError("invalid_request", 400, "Paste some text first.");
  if (text.length > MAX_INPUT) throw new AiError("prompt_too_large", 413, "That text is too long. Paste a shorter excerpt.");
  const draft = parseJson(await ask(buildPrompt(text, products), 4000));
  if (!draft) throw new AiError("invalid_json", 502, "Claude's answer couldn't be read. Try again.");
  return draft;
}

/* ---------- latest status from task statuses ---------- */

// Overdue is worked out here (not left to the model) so the summary can't miscount.
export function buildStatusPrompt(opp, today = todayStr()) {
  const groups = groupTasks(normTasks(opp.tasks));
  const lines = groups.map((g) => `${g.ws}:\n` + g.tasks.map((t) =>
    `- [${t.status}${isOverdue(t, today) ? ", OVERDUE" : ""}] ${t.t} (owner: ${t.owner || "unassigned"}, due: ${t.due || "no date"})`).join("\n")).join("\n");
  return `You write the "latest status" line shown to sales leadership for one deal, based ONLY on its task list.
Deal: ${opp.title || "Untitled"}${opp.client ? ` for ${opp.client}` : ""}. Stage: ${opp.stage || "New"}. Today: ${today}.

Tasks by workstream:
${lines}

Write 1-3 plain sentences (under 60 words, no markdown, no bullet points). Say what is done and in progress, and call out anything blocked or overdue by task name and owner. Do not invent facts, dates or people that are not in the task list. Reply with the status text only.`;
}

export async function draftStatus(opp) {
  if (!aiEnabled()) throw new AiError("ai_unavailable", 503, "Set ANTHROPIC_API_KEY to enable AI.");
  if (!normTasks(opp.tasks).length) throw new AiError("no_tasks", 400, "Add some tasks first; the status is written from them.");
  const text = (await ask(buildStatusPrompt(opp), 300)).trim().replace(/^["“]|["”]$/g, "");
  if (!text) throw new AiError("invalid_json", 502, "Claude's answer was empty. Try again.");
  return text;
}
