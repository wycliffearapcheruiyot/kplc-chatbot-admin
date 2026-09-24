// Shows the free-tier Render services being woken in parallel.
export default function Warmup({ targets, warmState, warming }) {
  return (
    <section className="warmup" aria-label="Backend warm-up status">
      <div className="warmup-title" data-active={warming}>
        {warming ? "Waking the backend services…" : "Some services are slow to respond"}
      </div>
      <ul className="warmup-list">
        {targets.map((t) => {
          const state = warmState[t.key] || "pending";
          return (
            <li key={t.key} className="warmup-item" data-state={state}>
              <span className="warmup-dot" aria-hidden="true" />
              <span className="warmup-label">{t.label}</span>
              <span className="warmup-state">{state === "ok" ? "warm" : state === "timeout" ? "slow to respond" : "waking…"}</span>
            </li>
          );
        })}
      </ul>
      <p className="warmup-detail">
        Render's free tier sleeps each service after ~15 idle minutes, and the first request back takes 30–60 s.
        All three are woken at once here so they don't wake one after another later.
      </p>
    </section>
  );
}
