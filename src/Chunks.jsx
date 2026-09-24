import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

function ChunkCard({ chunk, onSave }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(chunk.text);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { tone, text }
  const dirty = draft !== chunk.text;

  // keep the box in sync when the saved text changes (e.g. after a save + reload)
  useEffect(() => { setDraft(chunk.text); }, [chunk.text]);

  async function save() {
    setSaving(true);
    setMsg(null);
    setMsg(await onSave(chunk.id, draft));
    setSaving(false);
  }

  return (
    <article className="chunk" data-open={open}>
      <button className="chunk-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chunk-title">
          <strong>{chunk.topic}</strong>
          <span className="dim small">{chunk.section}</span>
        </span>
        <span className="mono small dim">{chunk.id}</span>
        <span className="chip" data-tone={chunk.embedded ? "live" : "current"}>
          {chunk.embedded ? "Searchable" : "Needs embedding"}
        </span>
      </button>
      {open && (
        <div className="chunk-body">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(16, Math.max(5, draft.split("\n").length + 2))} aria-label={`Text for ${chunk.topic}`} />
          <div className="row spread">
            <span className="dim small">{draft.length} characters{dirty ? " · unsaved changes" : ""}</span>
            <div className="row">
              {dirty && <button className="btn ghost" onClick={() => { setDraft(chunk.text); setMsg(null); }}>Discard</button>}
              <button className="btn primary" onClick={save} disabled={!dirty || !draft.trim() || saving}>{saving ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
          {msg && <div className={`notice ${msg.tone}`}>{msg.text}</div>}
        </div>
      )}
    </article>
  );
}

export default function Chunks({ ready, onAuthError }) {
  const [chunks, setChunks] = useState(null);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    try {
      setChunks(await api.chunks());
      setErr("");
    } catch (e) {
      if (e.status === 401) return onAuthError();
      setErr(e.message);
    }
  }, [onAuthError]);
  useEffect(() => { load(); }, [load]);

  const pending = chunks ? chunks.filter((c) => !c.embedded).length : 0;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!chunks) return [];
    return q ? chunks.filter((c) => [c.id, c.topic, c.section, c.text].some((f) => (f || "").toLowerCase().includes(q))) : chunks;
  }, [chunks, query]);

  async function runEmbed(force) {
    if (force && !window.confirm("Re-embed every chunk? This sends all of them through the model.")) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api.embed(force);
      setNote({ tone: "live", text: r.embedded ? `Embedded ${r.embedded} chunk${r.embedded === 1 ? "" : "s"}.` : "Nothing to embed." });
      await load();
    } catch (e) {
      if (e.status === 401) return onAuthError();
      setNote({ tone: "alert", text: e.status === 409 ? "No live model session. Start the model and wait for “Model live”, then try again." : e.message });
    } finally {
      setBusy(false);
    }
  }

  async function saveChunk(id, text) {
    try {
      await api.saveChunk(id, text);
    } catch (e) {
      if (e.status === 401) { onAuthError(); return null; }
      return { tone: "alert", text: `Not saved: ${e.message}` };
    }
    let result;
    if (ready) {
      try {
        await api.embed(false);
        result = { tone: "live", text: "Saved and re-embedded. The new wording is searchable now." };
      } catch (e) {
        result = { tone: "current", text: `Saved, but re-embedding failed: ${e.message} Use “Embed pending” above.` };
      }
    } else {
      result = { tone: "current", text: "Saved. This chunk is hidden from answers until you start the model and run “Embed pending”." };
    }
    await load();
    return result;
  }

  if (err) return <div className="notice alert">{err} <button className="btn" onClick={load}>Retry</button></div>;
  if (!chunks) return <p className="dim">Loading chunks… the gateway can take up to a minute to wake.</p>;

  return (
    <section>
      <div className="row spread toolbar">
        <input type="search" placeholder="Search by topic, id or text" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search chunks" />
        <div className="row">
          <span className="dim small">{chunks.length} chunks · {pending} need embedding</span>
          <button className="btn primary" onClick={() => runEmbed(false)} disabled={busy || !ready || pending === 0} title={ready ? "" : "Needs a live model session"}>Embed pending</button>
          <button className="btn ghost" onClick={() => runEmbed(true)} disabled={busy || !ready}>Re-embed all</button>
        </div>
      </div>
      {!ready && pending > 0 && <div className="notice current">{pending} chunk{pending === 1 ? " is" : "s are"} not searchable. Embedding runs on the Kaggle GPU, so start the model first.</div>}
      {note && <div className={`notice ${note.tone}`}>{note.text}</div>}
      <div className="list">
        {shown.map((c) => <ChunkCard key={c.id} chunk={c} onSave={saveChunk} />)}
        {shown.length === 0 && <p className="dim">{chunks.length ? "No chunks match that search." : "No chunks in MongoDB yet. Run populate_atlas.py from atlas_setup first."}</p>}
      </div>
    </section>
  );
}
