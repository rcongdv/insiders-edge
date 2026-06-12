import { fmtMoney, fmtNum, fmtPct, fmtName, TXN_CODES } from '../api.js';

export default function InsiderPanel({ insiders, loading, error, flow }) {
  return (
    <section className="panel" style={{ '--d': '180ms' }}>
      <div className="panel-head">
        <h3>Insider activity · Form 4</h3>
        {flow && (
          <span className="panel-stat">
            net 180d{' '}
            <b className={flow.buys180 - flow.sells180 >= 0 ? 'pos-text' : 'neg-text'}>
              {fmtMoney(flow.buys180 - flow.sells180)}
            </b>
          </span>
        )}
      </div>

      {error ? (
        <div className="panel-error">{error}</div>
      ) : loading ? (
        <SkeletonRows n={6} />
      ) : !insiders?.length ? (
        <p className="empty-note">No Form 4 filings found in the recent window.</p>
      ) : (
        <>
          {flow && flow.clusters.length > 0 && (
            <div className="cluster-strip">
              {flow.clusters.slice(0, 3).map((c) => (
                <div key={c.start} className={`cluster ${c.net >= 0 ? 'pos' : 'neg'}`}>
                  <span className="cluster-dates">
                    {c.start === c.end ? c.start : `${c.start} → ${c.end}`}
                  </span>
                  <span className="cluster-net">{fmtMoney(c.net)} net</span>
                  <span className="cluster-fwd">
                    +20d: <b>{fmtPct(c.fwd20)}</b>
                    {c.clusterBuy && <em className="cluster-flag"> · cluster buy ×{c.buyers}</em>}
                  </span>
                </div>
              ))}
            </div>
          )}

          <table className="txn-table">
            <thead>
              <tr>
                <th>insider</th>
                <th>txn</th>
                <th className="num">shares @ price</th>
                <th className="num">value</th>
              </tr>
            </thead>
            <tbody>
              {insiders.slice(0, 12).map((t, i) => {
                const code = TXN_CODES[t.code] ?? { label: `Code ${t.code}`, cls: 'plan' };
                return (
                  <tr key={i}>
                    <td>
                      <a className="owner" href={t.link} target="_blank" rel="noreferrer">
                        {fmtName(t.owner)}
                      </a>
                      <span className="owner-title">{t.title ?? (t.isOfficer ? 'Officer' : '')}</span>
                    </td>
                    <td>
                      <span className={`code-chip ${code.cls}`} title={code.label}>
                        {t.code}
                      </span>
                      <span className="txn-date">{t.date}</span>
                    </td>
                    <td className="num">
                      {fmtNum(t.shares)}
                      {t.price > 0 && <span className="at-price"> @ ${t.price.toFixed(2)}</span>}
                    </td>
                    <td className={`num ${t.code === 'P' ? 'pos-text' : t.code === 'S' ? 'neg-text' : ''}`}>
                      {t.value > 0 ? fmtMoney(t.value) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {flow?.hitRate != null && (
            <p className="footnote">
              Following insider direction after past filing clusters was right{' '}
              {Math.round(flow.hitRate * 100)}% of the time over the next 20 sessions.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function SkeletonRows({ n }) {
  return (
    <div className="skeleton-rows">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}
