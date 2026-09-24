// All calls go to the gateway only. The admin token lives in sessionStorage
// (cleared when the tab closes), never in the build.
const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const KEY = "kplc-admin-token";

const SESSION_URL = (import.meta.env.VITE_SESSION_BACKEND_URL || "").replace(/\/+$/, "");
const DATASET_URL = (import.meta.env.VITE_DATASET_BACKEND_URL || "").replace(/\/+$/, "");

export const gatewayUrl = BASE;

export function getToken() {
  try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; }
}
export function setToken(t) {
  try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// No client-side timeout on purpose: a sleeping Render service can take a minute to wake.
async function call(path, { method = "GET", body, admin = true } = {}) {
  if (!BASE) throw new ApiError("VITE_API_URL is not set. Add it in Netlify → Site settings → Environment variables, then redeploy.", 0);
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(admin ? { "X-Admin-Token": getToken() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(`Could not reach the gateway at ${BASE}. If it works from curl, add this site's exact origin to ALLOWED_ORIGINS on the gateway.`, 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(typeof data.detail === "string" ? data.detail : `HTTP ${res.status} (a free-tier service may still be waking; retry in a minute)`, res.status);
  return data;
}

export const api = {
  chunks: () => call("/chunks"),
  saveChunk: (id, text) => call(`/chunks/${encodeURIComponent(id)}`, { method: "PUT", body: { text } }),
  embed: (force = false) => call(`/chunks/embed${force ? "?force=true" : ""}`, { method: "POST" }),
  logs: (limit = 50) => call(`/chat_logs?limit=${limit}`),
  status: () => call("/session/status", { admin: false }),
  start: () => call("/session/start", { method: "POST", admin: false }),
};

// ---------------------------------------------------------------------------
// Warm-up (same approach as the Next.js chatbot). Render's free tier sleeps
// each service after ~15 idle minutes and takes 30-60 s to wake, and the three
// can wake one after another. So we nudge all three at once, then wait until
// each has really answered with HTTP 200.
// ---------------------------------------------------------------------------
const TARGETS = [
  { key: "gateway", label: "Gateway", url: BASE },
  { key: "session", label: "Session backend", url: SESSION_URL },
  { key: "dataset", label: "Dataset backend", url: DATASET_URL },
].filter((t) => !!t.url);

export const warmTargets = () => TARGETS.map(({ key, label }) => ({ key, label }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fire-and-forget nudge. Only the gateway allows this site's CORS origin, so the
// other two are pinged with no-cors: the request still wakes them, and we never
// read the (opaque) response.
async function nudge(url, timeoutMs = 5000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try { await fetch(`${url}/health`, { mode: "no-cors", cache: "no-store", signal: c.signal }); } catch { /* ignore */ } finally { clearTimeout(t); }
}

// Real CORS GET -> parsed JSON only on HTTP 200, else null (Render's 502 "waking" page lands here).
async function getJsonOk(path, timeoutMs = 30000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, { cache: "no-store", signal: c.signal });
    return res.ok ? await res.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

/**
 * Wakes the gateway, session backend and dataset backend. Resolves true only
 * once each has answered with 200 (session/dataset are checked by the gateway
 * via /health/upstreams, where the status code is readable). onUpdate(key, ok)
 * fires as each is confirmed. Gives up after maxMs and resolves false.
 */
export async function warmBackends(onUpdate, { maxMs = 150000, intervalMs = 4000 } = {}) {
  if (!BASE) return false;
  const deadline = Date.now() + maxMs;
  const done = {};
  const mark = (key, ok) => { if (done[key] !== ok) { done[key] = ok; onUpdate?.(key, ok); } };
  const has = (k) => TARGETS.some((t) => t.key === k);

  TARGETS.forEach((t) => { if (t.key !== "gateway") nudge(t.url); }); // wake all three in parallel

  while (Date.now() < deadline) {
    if (await getJsonOk("/health")) { mark("gateway", true); break; }
    await sleep(intervalMs);
  }
  if (!done.gateway) { TARGETS.forEach((t) => mark(t.key, false)); return false; }

  while (Date.now() < deadline) {
    const u = await getJsonOk("/health/upstreams", 100000);
    if (u) {
      const sessionOk = u.session_backend === true;
      const datasetOk = u.dataset_backend !== false; // null = dataset check disabled
      if (has("session")) mark("session", sessionOk);
      if (has("dataset")) mark("dataset", datasetOk);
      if (u.mongodb === true && sessionOk && datasetOk) return true;
    }
    await sleep(intervalMs);
  }
  TARGETS.forEach((t) => { if (done[t.key] !== true) mark(t.key, false); });
  return false;
}
