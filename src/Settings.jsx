import { useCallback, useEffect, useMemo, useState } from "react";
import { api, buildEnv, setToken } from "./api.js";

// Services whose code reads its settings from MongoDB at runtime.
const RUNTIME_SERVICES = new Set(["gateway", "session-backend", "dataset-backend", "kb-builder"]);

const APPLIES = {
  live: "applies within ~10 s",
  next_session: "applies on the next Kaggle session",
  build: "build-time · set in the host dashboard",
};

function when(ts) {
  if (!ts) return "";
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : ts + "Z");
  return isNaN(d) ? ts : d.toLocaleString();
}

// What the field holds before any edit: the saved override, else what the service reported from its env.
// The admin panel's own VITE_ values come from this build, since it is the only one that knows them.
function baseline(serviceId, v) {
  if (serviceId === "admin") return buildEnv[v.name] ?? "";
  return v.has_override ? v.override ?? "" : v.env ?? "";
}

function source(serviceId, v) {
  if (serviceId === "admin") return buildEnv[v.name] != null && buildEnv[v.name] !== "" ? ["Built in", "live"] : ["Not set", ""];
  if (v.has_override) return ["Override", "live"];
  if (v.env != null) return ["From env", ""];
  if (v.default != null) return ["Default", ""];
  return ["Not set", ""];
}

function VarRow({ serviceId, v, draft, onChange, onReset, disabled }) {
  const base = baseline(serviceId, v);
  const value = draft ?? base;
  const dirty = v.editable && value !== base;
  const [srcLabel, srcTone] = source(serviceId, v);
  const missing = v.required && !value.trim() && v.default == null;
  const envLine = v.editable && v.has_override ? (v.env != null ? v.env : "not set") : null;

  return (
    <article className="var" data-dirty={dirty}>
      <div className="var-head">
        <code className="var-name">{v.name}</code>
        <span className="row tight">
          {missing && <span className="chip" data-tone="alert">required · empty</span>}
          {v.secret && <span className="chip" data-tone="current">secret</span>}
          <span className="chip" data-tone={dirty ? "current" : srcTone}>{dirty ? "Unsaved" : srcLabel}</span>
        </span>
      </div>
      <p className="dim small var-desc">{v.description}</p>

      {v.editable ? (
        <input
          className="mono"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={v.default ?? v.placeholder ?? "not set"}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={disabled}
          aria-label={v.name}
        />
      ) : (
        <div className="readonly mono">{value || <span className="dim">not set</span>}</div>
      )}

      <div className="row spread small dim var-foot">
        <span>
          {APPLIES[v.applies]}
          {v.default != null && ` · default ${v.default}`}
          {envLine != null && <> · env var: <span className="mono">{envLine}</span></>}
        </span>
        {v.has_override && (
          <button className="btn ghost tiny" onClick={onReset} disabled={disabled} title="Remove the override so the service uses its own environment variable again">
            Reset to env
          </button>
        )}
      </div>
    </article>
  );
}

export default function Settings({ onAuthError }) {
  const [services, setServices] = useState(null);
  const [err, setErr] = useState("");
  const [active, setActive] = useState("gateway");
  const [drafts, setDrafts] = useState({}); // { [serviceId]: { [NAME]: value } } — survives switching services
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { tone, text }

  const load = useCallback(async () => {
    try {
      setServices((await api.settings()).services);
      setErr("");
    } catch (e) {
      if (e.status === 401) return onAuthError();
      setErr(e.message);
    }
  }, [onAuthError]);
  useEffect(() => { load(); }, [load]);

  const service = useMemo(() => services?.find((s) => s.id === active), [services, active]);
  const serviceDrafts = drafts[active] || {};

  // Only fields whose text differs from what is currently stored count as changes.
  const changes = useMemo(() => {
    if (!service) return {};
    const out = {};
    for (const v of service.vars) {
      const d = serviceDrafts[v.name];
      if (v.editable && d !== undefined && d !== baseline(active, v)) out[v.name] = d;
    }
    return out;
  }, [service, serviceDrafts, active]);
  const changeCount = Object.keys(changes).length;

  const setDraft = (name, value) => { setMsg(null); setDrafts((p) => ({ ...p, [active]: { ...p[active], [name]: value } })); };
  const clearDrafts = (id, names) => setDrafts((p) => {
    const next = { ...(p[id] || {}) };
    (names || Object.keys(next)).forEach((n) => delete next[n]);
    return { ...p, [id]: next };
  });
  const replaceService = (view) => setServices((list) => list.map((s) => (s.id === view.id ? view : s)));

  async function run(body, names, okText) {
    setBusy(true);
    setMsg(null);
    try {
      const view = await api.saveSettings(active, body);
      // Rotating ADMIN_TOKEN here must not sign this tab out.
      if (active === "gateway" && body.set?.ADMIN_TOKEN) setToken(body.set.ADMIN_TOKEN);
      replaceService(view);
      clearDrafts(active, names);
      setMsg({ tone: "live", text: okText(view) });
    } catch (e) {
      if (e.status === 401) return onAuthError();
      setMsg({ tone: "alert", text: `Not saved: ${e.message}` });
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (changes.ADMIN_TOKEN !== undefined && !window.confirm("Change the admin token? Every other signed-in admin session will be signed out. This tab stays signed in.")) return;
    const names = Object.keys(changes);
    const nextSession = names.some((n) => service.vars.find((v) => v.name === n)?.applies === "next_session");
    run({ set: changes }, names, () =>
      `Saved ${names.length} setting${names.length === 1 ? "" : "s"} for ${service.label}. ` +
      (RUNTIME_SERVICES.has(active) ? "The service picks them up within about 10 seconds, no redeploy needed." : "") +
      (nextSession ? " Some apply when the next Kaggle session starts." : ""));
  }

  const reset = (v) => run({ reset: [v.name] }, [v.name], () => `${v.name} reset. ${service.label} now uses its own environment variable${v.env != null ? "" : " (not set)"}.`);

  if (err) return <div className="notice alert">{err} <button className="btn" onClick={load}>Retry</button></div>;
  if (!services) return <p className="dim">Loading settings… the gateway can take up to a minute to wake.</p>;

  const overrides = (s) => s.vars.filter((v) => v.has_override).length;
  const reported = RUNTIME_SERVICES.has(active) && service.env_reported_at;

  return (
    <section>
      <div className="row spread toolbar">
        <p className="dim small" style={{ margin: 0, maxWidth: 560 }}>
          Edit every service's environment variables here. Changes are stored in MongoDB and read by the services at runtime;
          the real environment variable is the fallback. Secrets are shown in full.
        </p>
        <button className="btn ghost" onClick={load} disabled={busy}>Refresh</button>
      </div>

      <div className="svc-tabs" role="tablist" aria-label="Service">
        {services.map((s) => (
          <button key={s.id} role="tab" aria-selected={active === s.id} onClick={() => { setActive(s.id); setMsg(null); }}>
            {s.label}
            {overrides(s) > 0 && <span className="count">{overrides(s)}</span>}
            {drafts[s.id] && Object.keys(drafts[s.id]).length > 0 && <span className="dot" title="Unsaved edits" />}
          </button>
        ))}
      </div>

      <div className="svc-intro">
        <p className="dim small" style={{ margin: 0 }}>{service.description}</p>
        {reported && <span className="dim small mono">env reported {when(service.env_reported_at)}</span>}
      </div>

      {RUNTIME_SERVICES.has(active) && !service.env_reported_at && (
        <div className="notice current">
          This service hasn't reported its environment yet, so “env var” values are blank. Deploy its updated code with
          <code> MONGODB_URI</code> set. Overrides you save now apply as soon as it starts.
        </div>
      )}
      {active === "admin" && <div className="notice">These are the values this admin panel was built with. Change them in Netlify and redeploy.</div>}
      {msg && <div className={`notice ${msg.tone}`} role="status">{msg.text}</div>}

      <div className="list">
        {service.vars.map((v) => (
          <VarRow
            key={v.name}
            serviceId={active}
            v={v}
            draft={serviceDrafts[v.name]}
            onChange={(val) => setDraft(v.name, val)}
            onReset={() => reset(v)}
            disabled={busy}
          />
        ))}
      </div>

      {service.vars.some((v) => v.editable) && (
        <div className="savebar">
          <span className="dim small">{changeCount ? `${changeCount} unsaved change${changeCount === 1 ? "" : "s"}` : "No changes"}</span>
          <div className="row">
            <button className="btn ghost" onClick={() => { clearDrafts(active); setMsg(null); }} disabled={!changeCount || busy}>Discard</button>
            <button className="btn primary" onClick={save} disabled={!changeCount || busy}>{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
