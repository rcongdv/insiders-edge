import { useEffect, useRef, useState } from 'react';

function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0);
  const raf = useRef(null);
  useEffect(() => {
    if (target == null) return;
    const start = performance.now();
    const from = 0;
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return value;
}

export default function ScoreCard({ company, composite, loading, error }) {
  const shown = useCountUp(composite?.score ?? null);

  return (
    <section className="panel score-card" style={{ '--d': '0ms' }}>
      <div className="score-id">
        <span className="score-ticker">{company.ticker}</span>
        <span className="score-name">{company.name}</span>
      </div>

      {error ? (
        <div className="panel-error">{error}</div>
      ) : loading || !composite ? (
        <div className="score-loading">
          <div className="skeleton skeleton-score" />
          <span className="loading-note">reading the tape &amp; parsing filings…</span>
        </div>
      ) : (
        <>
          <div className={`score-dial tone-${composite.tone}`}>
            <span className="score-value">{shown}</span>
            <span className="score-scale">/100</span>
          </div>
          <div className="score-verdict">
            <span className={`verdict-tag tone-${composite.tone}`}>{composite.verdict}</span>
            <span className="verdict-sub">composite smart-money score</span>
          </div>
          <div className="score-components">
            {composite.components.map((c) => (
              <div key={c.key} className="component">
                <div className="component-head">
                  <span>{c.label}</span>
                  <span className="component-score">{c.score}</span>
                </div>
                <div className="meter">
                  <div
                    className={`meter-fill ${c.score >= 50 ? 'pos' : 'neg'}`}
                    style={{ width: `${c.score}%` }}
                  />
                  <div className="meter-mid" />
                </div>
                <span className="component-weight">w {Math.round(c.weight * 100)}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
