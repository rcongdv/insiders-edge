import { useEffect, useState } from 'react';
import { useApi, fmtMoney, fmtCompact, fmtPct } from '../api.js';

const fmtPrice = (n) =>
  n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function RobinhoodPanel({ navigate }) {
  const [nonce, setNonce] = useState(0);
  const [refreshCount, setRefreshCount] = useState(0);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  // Landing after the OAuth callback redirect (?rh=connected | ?rh=error&msg=…).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rh = params.get('rh');
    if (!rh) return;
    if (rh === 'error') setNotice(params.get('msg') || 'Robinhood sync failed');
    history.replaceState(null, '', window.location.pathname);
  }, []);

  const status = useApi(`/api/robinhood/status?n=${nonce}`);
  const connected = status.data?.connected ?? false;
  const portfolio = useApi(
    connected
      ? `/api/robinhood/portfolio?n=${nonce}${refreshCount ? `&refresh=${refreshCount}` : ''}`
      : null,
  );
  const expired = portfolio.status === 401;

  const connect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch('/api/robinhood/connect', { method: 'POST' });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`);
      if (body.connected) setNonce((n) => n + 1);
      else window.location.assign(body.authUrl);
    } catch (err) {
      setNotice(err.message);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await fetch('/api/robinhood/disconnect', { method: 'POST' }).catch(() => {});
    setRefreshCount(0);
    setNonce((n) => n + 1);
  };

  const positions = portfolio.data?.positions ?? [];
  const watchlists = portfolio.data?.watchlists ?? [];

  return (
    <section className="rh-panel panel" style={{ '--d': '180ms' }}>
      <div className="panel-head">
        <h3>Robinhood</h3>
        <span className="panel-stat">
          {connected && portfolio.data
            ? `synced ${new Date(portfolio.data.fetchedAt).toLocaleTimeString()}`
            : 'positions · watchlists'}
        </span>
      </div>

      {!connected || expired ? (
        <>
          {notice && <div className="panel-error">{notice}</div>}
          {expired && <div className="panel-error">Robinhood session expired — sync again.</div>}
          <p className="empty-note">
            Pull your positions and watchlists through Robinhood&rsquo;s official agentic API and
            jump straight to the tape on any of them. First sync asks you to approve an Agentic
            account on robinhood.com (desktop browser only). Read-only — nothing is stored on
            disk, and the link is forgotten when the server restarts.
          </p>
          <button className="rh-sync-btn" onClick={connect} disabled={busy || status.loading}>
            {busy ? 'Connecting…' : '⟳ Sync with Robinhood'}
          </button>
        </>
      ) : portfolio.error && !expired ? (
        <div className="panel-error">{portfolio.error}</div>
      ) : portfolio.loading || !portfolio.data ? (
        <div className="skeleton-rows">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      ) : (
        <>
          <p className="sub-head">Positions</p>
          {positions.length === 0 ? (
            <p className="empty-note">No open positions in your Robinhood accounts.</p>
          ) : (
            <div className="rh-pos-grid">
              {positions.map((p) => (
                <button key={p.symbol} className="rh-pos-card" onClick={() => navigate(p.symbol)}>
                  <span className="rh-pos-top">
                    <span className="rh-pos-symbol">{p.symbol}</span>
                    <span className="rh-pos-value">{fmtMoney(p.marketValue)}</span>
                  </span>
                  <span className="rh-pos-meta">
                    {fmtCompact(p.quantity)} sh · avg {fmtPrice(p.avgCost)}
                  </span>
                  <span className={`rh-pnl ${p.pnl > 0 ? 'up' : p.pnl < 0 ? 'down' : ''}`}>
                    {p.pnl == null ? '—' : `${p.pnl > 0 ? '+' : p.pnl < 0 ? '−' : ''}${fmtMoney(Math.abs(p.pnl))}`}
                    {p.pnlPct != null && ` (${fmtPct(p.pnlPct)})`}
                  </span>
                </button>
              ))}
            </div>
          )}

          {watchlists.length > 0 &&
            watchlists.map((w) => (
              <div key={w.name}>
                <p className="sub-head">{w.name}</p>
                <div className="rh-watch-row">
                  {w.symbols.map((s) => (
                    <button key={s} className="chip chip-btn" onClick={() => navigate(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}

          <p className="footnote rh-controls">
            Live from Robinhood&rsquo;s agentic API · in-memory only.{' '}
            <button className="rh-link" onClick={() => setRefreshCount((n) => n + 1)}>
              refresh
            </button>{' '}
            ·{' '}
            <button className="rh-link" onClick={disconnect}>
              disconnect
            </button>
          </p>
        </>
      )}
    </section>
  );
}
