import { useEffect, useMemo, useState } from 'react';
import { fmtCompact, useApi } from '../api.js';
import { optionsFlow } from '../analytics/optionsFlow.js';

const expLabel = (unix) => new Date(unix * 1000).toISOString().slice(0, 10);
const usd = (n) => (n == null ? '—' : `$${n % 1 ? n.toFixed(2) : n.toFixed(0)}`);
const ratio = (n) => (n == null ? '—' : n.toFixed(2));

function Stat({ label, value, tone }) {
  return (
    <div className="stat-cell">
      <span className="stat-label">{label}</span>
      <span className={`stat-value${tone ? ` ${tone}` : ''}`}>{value}</span>
    </div>
  );
}

export default function OptionsPanel({ ticker }) {
  const [date, setDate] = useState(null);
  const [showChain, setShowChain] = useState(false);
  const { data, error, loading } = useApi(
    ticker && `/api/options/${encodeURIComponent(ticker)}${date ? `?date=${date}` : ''}`,
  );

  // Keep the expiration list across refetches so the select doesn't vanish
  // while a newly chosen expiration loads.
  const [exps, setExps] = useState([]);
  useEffect(() => {
    if (data?.expirations?.length) setExps(data.expirations);
  }, [data]);

  const flow = useMemo(() => optionsFlow(data), [data]);

  return (
    <section className="panel options-panel" style={{ '--d': '450ms' }}>
      <div className="panel-head">
        <h3>Options flow</h3>
        {exps.length > 0 && (
          <select
            className="exp-select"
            value={date ?? data?.expiration ?? exps[0]}
            onChange={(e) => setDate(Number(e.target.value))}
            aria-label="Expiration date"
          >
            {exps.map((d) => (
              <option key={d} value={d}>
                exp {expLabel(d)}
              </option>
            ))}
          </select>
        )}
      </div>

      {error ? (
        <div className="panel-error">{error}</div>
      ) : loading ? (
        <div className="skeleton-rows">
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
        </div>
      ) : !flow ? (
        <p className="empty-note">
          No listed options for this symbol, or options data is unavailable upstream.
        </p>
      ) : (
        <>
          <div className="stat-grid options-stats">
            <Stat
              label="put/call vol"
              value={ratio(flow.pcVolume)}
              tone={flow.pcVolume == null ? null : flow.pcVolume > 1 ? 'neg-text' : 'pos-text'}
            />
            <Stat label="put/call oi" value={ratio(flow.pcOI)} />
            <Stat label="max pain" value={usd(flow.maxPain)} />
            <Stat
              label="atm iv"
              value={flow.atmIv == null ? '—' : `${(flow.atmIv * 100).toFixed(1)}%`}
            />
          </div>

          {flow.unusual.length > 0 && (
            <>
              <h4 className="sub-head">unusual activity · volume ≫ open interest</h4>
              <ul className="unusual-list">
                {flow.unusual.map((u) => (
                  <li key={`${u.type}${u.strike}`}>
                    <span className={`code-chip ${u.type === 'C' ? 'buy' : 'sell'}`}>
                      {u.type === 'C' ? 'CALL' : 'PUT'}
                    </span>
                    <span className="unusual-strike">{usd(u.strike)}</span>
                    {data.expiration && <span className="unusual-exp">{expLabel(data.expiration)}</span>}
                    <span className="unusual-vol">
                      {fmtCompact(u.volume)} vol / {fmtCompact(u.oi)} oi
                    </span>
                    <b className="unusual-ratio">
                      {u.ratio >= 10 ? u.ratio.toFixed(0) : u.ratio.toFixed(1)}×
                    </b>
                  </li>
                ))}
              </ul>
            </>
          )}

          <button className="chip chip-btn toggle-btn" onClick={() => setShowChain(!showChain)}>
            {showChain ? '[ hide chain ]' : '[ view chain ]'}
          </button>
          {showChain && <ChainTable data={data} />}
        </>
      )}
    </section>
  );
}

function ChainTable({ data }) {
  const { calls, puts, spot } = data;
  const strikes = [...new Set([...calls, ...puts].map((c) => c.strike))]
    .filter((s) => s != null)
    .sort((a, b) => a - b);
  const callBy = new Map(calls.map((c) => [c.strike, c]));
  const putBy = new Map(puts.map((p) => [p.strike, p]));
  const atm =
    spot == null
      ? null
      : strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), strikes[0]);

  const Side = ({ c }) => (
    <>
      <td className={`num${c?.itm ? ' itm' : ''}`}>{c?.last != null ? c.last.toFixed(2) : '—'}</td>
      <td className={`num${c?.itm ? ' itm' : ''}`}>
        {c?.bid != null || c?.ask != null
          ? `${c?.bid?.toFixed(2) ?? '—'}/${c?.ask?.toFixed(2) ?? '—'}`
          : '—'}
      </td>
      <td className={`num${c?.itm ? ' itm' : ''}`}>{c ? fmtCompact(c.volume) : '—'}</td>
      <td className={`num${c?.itm ? ' itm' : ''}`}>{c ? fmtCompact(c.oi) : '—'}</td>
      <td className={`num${c?.itm ? ' itm' : ''}`}>
        {c?.iv != null && c.iv > 0 ? `${(c.iv * 100).toFixed(0)}%` : '—'}
      </td>
    </>
  );

  return (
    <div className="chain-wrap">
      <table className="txn-table chain-table">
        <thead>
          <tr>
            <th colSpan={5} className="side-head">
              calls
            </th>
            <th className="strike-col" />
            <th colSpan={5} className="side-head">
              puts
            </th>
          </tr>
          <tr>
            <th className="num">last</th>
            <th className="num">bid/ask</th>
            <th className="num">vol</th>
            <th className="num">oi</th>
            <th className="num">iv</th>
            <th className="strike-col">strike</th>
            <th className="num">last</th>
            <th className="num">bid/ask</th>
            <th className="num">vol</th>
            <th className="num">oi</th>
            <th className="num">iv</th>
          </tr>
        </thead>
        <tbody>
          {strikes.map((s) => (
            <tr key={s} className={s === atm ? 'atm-row' : ''}>
              <Side c={callBy.get(s)} />
              <td className="strike-col">{s % 1 ? s.toFixed(2) : s}</td>
              <Side c={putBy.get(s)} />
            </tr>
          ))}
        </tbody>
      </table>
      {spot != null && (
        <p className="footnote">
          Spot ${spot.toFixed(2)} — highlighted row is the at-the-money strike; tinted cells are in
          the money.
        </p>
      )}
    </div>
  );
}
