import { useMemo, useState } from 'react';
import { useApi } from './api.js';
import { volumeAnomaly } from './analytics/volumeAnomaly.js';
import { execPatterns } from './analytics/execPatterns.js';
import { insiderFlow } from './analytics/insiderFlow.js';
import { smartMoneyScore } from './analytics/smartMoneyScore.js';
import TickerSearch from './components/TickerSearch.jsx';
import ScoreCard from './components/ScoreCard.jsx';
import PriceChart from './components/PriceChart.jsx';
import InsiderPanel from './components/InsiderPanel.jsx';
import AlgoPanel from './components/AlgoPanel.jsx';
import InstitutionalPanel from './components/InstitutionalPanel.jsx';

const SUGGESTIONS = [
  { ticker: 'NVDA', name: 'NVIDIA CORP' },
  { ticker: 'AAPL', name: 'Apple Inc.' },
  { ticker: 'TSLA', name: 'Tesla, Inc.' },
  { ticker: 'PLTR', name: 'Palantir Technologies Inc.' },
  { ticker: 'JPM', name: 'JPMorgan Chase & Co.' },
];

export default function App() {
  const [company, setCompany] = useState(null);

  const prices = useApi(company && `/api/prices/${company.ticker}`);
  const insiders = useApi(company && `/api/insiders/${company.ticker}`);
  const institutional = useApi(company && `/api/institutional/${company.ticker}`);

  const analytics = useMemo(() => {
    if (!prices.data?.length) return null;
    const volume = volumeAnomaly(prices.data);
    const exec = execPatterns(prices.data);
    const flow = insiders.data ? insiderFlow(insiders.data, prices.data) : null;
    const composite = flow ? smartMoneyScore({ flow, volume, exec }) : null;
    return { volume, exec, flow, composite };
  }, [prices.data, insiders.data]);

  return (
    <div className="app">
      <div className="scanlines" aria-hidden="true" />
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark">▚</span>
          <h1>
            Insider <em>Edge</em>
          </h1>
          <span className="brand-sub">smart money terminal</span>
        </div>
        <TickerSearch onSelect={setCompany} />
      </header>

      {!company ? (
        <section className="hero">
          <p className="hero-kicker">SEC EDGAR · Form 4 · 13F-HR · daily tape</p>
          <h2 className="hero-title">
            Follow the footprints,
            <br />
            not the headlines.
          </h2>
          <p className="hero-copy">
            Real insider filings, sampled institutional positions, and algorithmic execution
            signatures read straight off the tape — fused into one composite view of where the
            smart money is leaning.
          </p>
          <div className="hero-chips">
            {SUGGESTIONS.map((s) => (
              <button key={s.ticker} className="chip chip-btn" onClick={() => setCompany(s)}>
                {s.ticker}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <main key={company.ticker} className="dashboard">
          <ScoreCard
            company={company}
            composite={analytics?.composite}
            loading={prices.loading || insiders.loading}
            error={prices.error}
          />
          <PriceChart
            prices={prices.data}
            loading={prices.loading}
            error={prices.error}
            insiders={insiders.data}
            anomalies={analytics?.volume?.anomalies ?? []}
          />
          <div className="panel-grid">
            <InsiderPanel
              insiders={insiders.data}
              loading={insiders.loading}
              error={insiders.error}
              flow={analytics?.flow}
            />
            <AlgoPanel
              loading={prices.loading}
              error={prices.error}
              volume={analytics?.volume}
              exec={analytics?.exec}
            />
            <InstitutionalPanel
              data={institutional.data}
              loading={institutional.loading}
              error={institutional.error}
            />
          </div>
        </main>
      )}

      <footer className="colophon">
        Data: SEC EDGAR (Form 4, 13F-HR) &amp; Yahoo Finance daily OHLCV. Algorithmic-behavior signals are
        heuristics computed from the daily tape, not tick data. Research &amp; education only — not
        investment advice.
      </footer>
    </div>
  );
}
