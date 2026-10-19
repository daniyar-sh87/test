// REST client for the Opportunity Desk API.
export async function call(method, path, body, signal) {
  const res = await fetch(path, { method, signal, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { code: data.code, status: res.status });
  return data;
}

export const api = {
  list: (c) => call("GET", `/api/${c}`),
  create: (c, d) => call("POST", `/api/${c}`, d),
  replace: (c, id, d) => call("PUT", `/api/${c}/${encodeURIComponent(id)}`, d),
  remove: (c, id) => call("DELETE", `/api/${c}/${encodeURIComponent(id)}`),
  updates: (id) => call("GET", `/api/opps/${encodeURIComponent(id)}/updates`),
  // body: { author, text?, nextStep?, dueDate?, stage? } -> { update, opp }
  postUpdate: (id, body) => call("POST", `/api/opps/${encodeURIComponent(id)}/updates`, body),
  draft: (text, signal) => call("POST", "/api/ai/draft", { text }, signal),
};
