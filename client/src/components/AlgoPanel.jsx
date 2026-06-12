export default function AlgoPanel({ loading, error, volume, exec }) {
  return (
    <section className="panel" style={{ '--d': '270ms' }}>
      <div className="panel-head">
        <h3>Algorithmic behavior</h3>
        <span className="panel-stat">daily-tape heuristics</span>
      </div>

      {error ? (
        <div className="panel-error">{error}</div>
      ) : loading || !volume || !exec ? (
        <div className="skeleton-rows">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      ) : (
        <>
          {volume.divergence && (
            <div className={`callout ${volume.divergence.type === 'accumulation' ? 'pos' : 'neg'}`}>
              <b>{volume.divergence.type === 'accumulation' ? '▲ Accumulation divergence' : '▼ Distribution divergence'}</b>
              <p>{volume.divergence.explanation}</p>
            </div>
          )}

          <h4 className="sub-head">Execution signatures</h4>
          {exec.signatures.length === 0 ? (
            <p className="empty-note">
              No systematic execution footprints detected — volume looks bursty and news-driven
              rather than scheduled.
            </p>
          ) : (
            <ul className="sig-list">
              {exec.signatures.slice(0, 4).map((s, i) => (
                <li key={i} className="sig">
                  <div className="sig-head">
                    <span className={`sig-type ${s.direction === 'accumulation' ? 'pos' : 'neg'}`}>
                      {s.direction === 'accumulation' ? '▲' : '▼'} {s.type}
                    </span>
                    <span className="sig-dates">
                      {s.start} → {s.end}
                    </span>
                  </div>
                  <div className="confidence">
                    <div className="meter">
                      <div
                        className={`meter-fill ${s.direction === 'accumulation' ? 'pos' : 'neg'}`}
                        style={{ width: `${Math.round(s.confidence * 100)}%` }}
                      />
                    </div>
                    <span>{Math.round(s.confidence * 100)}%</span>
                  </div>
                  <p className="sig-why">{s.explanation}</p>
                </li>
              ))}
            </ul>
          )}

          <h4 className="sub-head">Volume anomalies</h4>
          {volume.anomalies.length === 0 ? (
            <p className="empty-note">No abnormal volume days in the window.</p>
          ) : (
            <ul className="anomaly-list">
              {[...volume.anomalies]
                .reverse()
                .slice(0, 5)
                .map((a) => (
                  <li key={a.date}>
                    <span className="anomaly-date">{a.date}</span>
                    <span className={`anomaly-kind ${a.direction === 'up' ? 'pos-text' : 'neg-text'}`}>
                      {a.kind}
                    </span>
                    <span className="anomaly-z">z {a.z}</span>
                  </li>
                ))}
            </ul>
          )}

          <p className="footnote">
            Signatures are inferred from daily OHLCV only — directional footprints consistent with
            algorithmic execution, not proof of it.
          </p>
        </>
      )}
    </section>
  );
}
