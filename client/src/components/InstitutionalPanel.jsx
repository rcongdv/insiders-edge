import { fmtMoney, fmtCompact } from '../api.js';

export default function InstitutionalPanel({ data, loading, error }) {
  const holders = data?.holders ?? [];
  const maxValue = holders[0]?.value || 1;

  return (
    <section className="panel" style={{ '--d': '360ms' }}>
      <div className="panel-head">
        <h3>Institutional holders · 13F</h3>
        <span className="panel-stat">{holders.length ? `${holders.length} filers` : ''}</span>
      </div>

      {error ? (
        <div className="panel-error">{error}</div>
      ) : loading ? (
        <div className="skeleton-rows">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      ) : holders.length === 0 ? (
        <p className="empty-note">
          No 13F information tables matched via full-text search. Smaller issuers and recent IPOs
          often surface poorly here.
        </p>
      ) : (
        <>
          <ul className="holder-list">
            {holders.map((h) => (
              <li key={h.filer} className="holder">
                <div className="holder-row">
                  <a className="holder-name" href={h.link} target="_blank" rel="noreferrer">
                    {h.filer}
                  </a>
                  <span className="holder-value">{fmtMoney(h.value)}</span>
                </div>
                <div className="holder-bar">
                  <div style={{ width: `${Math.max(3, (h.value / maxValue) * 100)}%` }} />
                </div>
                <div className="holder-meta">
                  <span>{fmtCompact(h.shares)} sh</span>
                  {h.putCall && <span className="code-chip plan">{h.putCall}</span>}
                  <span>{h.period ? `as of ${h.period}` : `filed ${h.filedAt}`}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="footnote">
            Sampled from recent 13F-HR filings via EDGAR full-text search — a directional sample of
            large holders, not a complete census. Positions lag up to 45 days.
          </p>
        </>
      )}
    </section>
  );
}
