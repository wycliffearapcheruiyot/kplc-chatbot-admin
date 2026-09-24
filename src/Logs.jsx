import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

// The gateway returns UTC datetimes without a zone suffix; treat them as UTC.
function when(ts) {
  if (!ts) return "";
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : ts + "Z");
  return isNaN(d) ? ts : d.toLocaleString();
}

export default function Logs({ onAuthError }) {
  const [limit, setLimit] = useState(50);
  const [logs, setLogs] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLogs(await api.logs(limit));
      setErr("");
    } catch (e) {
      if (e.status === 401) return onAuthError();
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [limit, onAuthError]);
  useEffect(() => { load(); }, [load]);

  return (
    <section>
      <div className="row spread toolbar">
        <span className="dim small">{logs ? `Newest ${logs.length} conversation${logs.length === 1 ? "" : "s"}` : ""}</span>
        <div className="row">
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="How many to load">
            {[50, 100, 200, 500].map((n) => <option key={n} value={n}>Last {n}</option>)}
          </select>
          <button className="btn" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>
      {err && <div className="notice alert">{err}</div>}
      {!logs && !err && <p className="dim">Loading logs…</p>}
      {logs?.length === 0 && <p className="dim">No conversations yet. Ask the chatbot a question and it will appear here.</p>}
      <div className="list">
        {logs?.map((l, i) => (
          <article className="log" key={i}>
            <div className="row spread small dim">
              <span>{when(l.timestamp)}</span>
              <span className="mono">{(l.retrieved_chunk_ids || []).join(", ") || "no chunks retrieved"}</span>
            </div>
            <p className="q">{l.question}</p>
            <p className="a">{l.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
