import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken, gatewayUrl, warmBackends, warmTargets } from "./api.js";
import Warmup from "./Warmup.jsx";
import Chunks from "./Chunks.jsx";
import Logs from "./Logs.jsx";

const STATUS = {
  idle: ["Model off", ""],
  preparing_dataset: ["Preparing model files", "current"],
  starting: ["Model booting", "current"],
  ready: ["Model live", "live"],
  error: ["Session error", "alert"],
};

function Login({ onLogin, message }) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState(message || "");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setToken(value.trim());
    try {
      await api.logs(1); // cheapest admin call: proves the token works
      onLogin();
    } catch (ex) {
      setToken("");
      setErr(ex.status === 401 ? "That token was rejected. Check it matches ADMIN_TOKEN on the gateway." : ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="panel" onSubmit={submit}>
        <h1>Kenya Power chatbot admin</h1>
        <p className="dim">Enter the admin token to edit the knowledge base and read chat logs. It stays in this tab only.</p>
        <input type="password" autoFocus autoComplete="off" placeholder="Admin token" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Admin token" />
        {err && <div className="notice alert" role="alert">{err}</div>}
        <button className="btn primary" disabled={!value.trim() || busy}>{busy ? "Checking…" : "Sign in"}</button>
        <p className="dim small mono">{gatewayUrl || "VITE_API_URL not set"}</p>
      </form>
    </main>
  );
}

const TARGETS = warmTargets();
const initialWarm = () => Object.fromEntries(TARGETS.map((t) => [t.key, "pending"]));

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [loginMsg, setLoginMsg] = useState("");
  const [tab, setTab] = useState("chunks");
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState("");
  const [warming, setWarming] = useState(true);
  const [warmState, setWarmState] = useState(initialWarm);
  const [warmOk, setWarmOk] = useState(false);
  const [skipWarm, setSkipWarm] = useState(false);

  // Wake all three services and wait for them. Nothing else happens until this settles.
  const ensureWarm = useCallback(async () => {
    setWarming(true);
    setWarmState(initialWarm());
    const ok = await warmBackends((key, up) => setWarmState((p) => ({ ...p, [key]: up ? "ok" : "timeout" })));
    setWarmOk(ok);
    setWarming(false);
    return ok;
  }, []);
  useEffect(() => { ensureWarm(); }, [ensureWarm]);

  const logout = useCallback((msg = "") => {
    setToken("");
    setLoginMsg(msg);
    setAuthed(false);
  }, []);
  const expired = useCallback(() => logout("Your token was rejected. Sign in again."), [logout]);

  // Poll session status so the panel knows when embedding is possible.
  useEffect(() => {
    if (!authed || !(warmOk || skipWarm)) return;
    let stop = false;
    const tick = async () => {
      try { const s = await api.status(); if (!stop) setSession(s); } catch { /* keep last known status */ }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(id); };
  }, [authed, warmOk, skipWarm]);

  async function startDemo() {
    setStarting(true);
    setStartErr("");
    try {
      // The page may have sat open long enough for the services to fall asleep again.
      if (!(await ensureWarm())) throw new Error("The backend services are still waking up. Wait a minute and try again.");
      setSession(await api.start());
    } catch (e) {
      setStartErr(e.message);
    }
    setStarting(false);
  }

  // Warm-up gate: runs before the login screen and before any admin call.
  if (!warmOk && !skipWarm) {
    return (
      <main className="login">
        <div className="gate">
          <h1>KPLC chatbot admin</h1>
          <Warmup targets={TARGETS} warmState={warmState} warming={warming} />
          {!warming && (
            <div className="row">
              <button className="btn primary" onClick={ensureWarm}>Retry</button>
              <button className="btn ghost" onClick={() => setSkipWarm(true)}>Continue anyway</button>
            </div>
          )}
          {!gatewayUrl && <div className="notice alert">VITE_API_URL is not set. Add it in Netlify environment variables and redeploy.</div>}
        </div>
      </main>
    );
  }

  if (!authed) return <Login message={loginMsg} onLogin={() => { setLoginMsg(""); setAuthed(true); }} />;

  const status = session?.status;
  const [label, tone] = STATUS[status] || ["Checking session…", ""];
  const canStart = status === "idle" || status === "error";
  const busyLabel = warming ? "Waking services…" : "Start model";

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <div className="brand">KPLC chatbot admin</div>
          <div className="dim small mono">{gatewayUrl}</div>
        </div>
        <div className="row">
          <span className="chip" data-tone={tone}>{label}</span>
          {canStart && <button className="btn" onClick={startDemo} disabled={starting}>{starting ? busyLabel : "Start model"}</button>}
          <button className="btn ghost" onClick={() => logout()}>Sign out</button>
        </div>
      </header>

      {starting && warming && <div className="gate-inline"><Warmup targets={TARGETS} warmState={warmState} warming={warming} /></div>}
      {startErr && <div className="notice alert" style={{ marginTop: 14 }}>{startErr}</div>}

      <nav className="tabs" role="tablist">
        {[["chunks", "Knowledge base"], ["logs", "Chat logs"]].map(([k, name]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{name}</button>
        ))}
      </nav>

      {tab === "chunks"
        ? <Chunks ready={status === "ready"} onAuthError={expired} />
        : <Logs onAuthError={expired} />}
    </div>
  );
}
