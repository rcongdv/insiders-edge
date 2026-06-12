import { useEffect, useMemo } from 'react';
import { useApi } from './api.js';
import { useRoute } from './useRoute.js';
import { volumeAnomaly } from './analytics/volumeAnomaly.js';
import { execPatterns } from './analytics/execPatterns.js';
import { insiderFlow } from './analytics/insiderFlow.js';
import { smartMoneyScore } from './analytics/smartMoneyScore.js';
import TickerSearch from './components/TickerSearch.jsx';
import ScoreCard from './components/ScoreCard.jsx';
import ProfilePanel from './components/ProfilePanel.jsx';
import PriceChart from './components/PriceChart.jsx';
import InsiderPanel from './components/InsiderPanel.jsx';
import AlgoPanel from './components/AlgoPanel.jsx';
import InstitutionalPanel from './components/InstitutionalPanel.jsx';
import OptionsPanel from './components/OptionsPanel.jsx';
import RobinhoodPanel from './components/RobinhoodPanel.jsx';

const SUGGESTIONS = ['NVDA', 'AAPL', 'TSLA', 'PLTR', 'JPM'];

export default function App() {
  const [ticker, navigate] = useRoute();

  const profile = useApi(ticker && `/api/profile/${encodeURIComponent(ticker)}`);
  const prices = useApi(ticker && `/api/prices/${encodeURIComponent(ticker)}`);
  const insiders = useApi(ticker && `/api/insiders/${encodeURIComponent(ticker)}`);
  const institutional = useApi(ticker && `/api/institutional/${encodeURIComponent(ticker)}`);

  const analytics = useMemo(() => {
    if (!prices.data?.length) return null;
    const volume = volumeAnomaly(prices.data);
    const exec = execPatterns(prices.data);
    const flow = insiders.data ? insiderFlow(insiders.data, prices.data) : null;
    const composite = flow ? smartMoneyScore({ flow, volume, exec }) : null;
    return { volume, exec, flow, composite };
  }, [prices.data, insiders.data]);

  useEffect(() => {
    const name = profile.data?.name;
    document.title = ticker
      ? `${ticker}${name ? ` · ${name}` : ''} · Insider Edge`
      : 'Insider Edge — smart money terminal';
  }, [ticker, profile.data]);

  const company = profile.data ?? { ticker, name: '' };
  const notFound = profile.status === 404;

  const chips = (
    <div className="hero-chips">
      {SUGGESTIONS.map((t) => (
        <button key={t} className="chip chip-btn" onClick={() => navigate(t)}>
          {t}
        </button>
      ))}
    </div>
  );

  return (
    <div className="app">
      <div className="scanlines" aria-hidden="true" />
      <header className="masthead">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate(null);
          }}
        >
          <span className="brand-mark">▚</span>
          <h1>
            Insider <em>Edge</em>
          </h1>
          <span className="brand-sub">smart money terminal</span>
        </a>
        <TickerSearch onSelect={(c) => navigate(c.ticker)} />
      </header>

      {!ticker ? (
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
          {chips}
          <RobinhoodPanel navigate={navigate} />
        </section>
      ) : notFound ? (
        <section className="hero">
          <p className="hero-kicker">404 · unknown symbol</p>
          <h2 className="hero-title">No tape for “{ticker}”.</h2>
          <p className="hero-copy">
            {profile.error ?? 'That ticker is not in SEC’s registry.'} Try one of these instead:
          </p>
          {chips}
        </section>
      ) : (
        <main key={ticker} className="dashboard">
          <ScoreCard
            company={company}
            composite={analytics?.composite}
            loading={prices.loading || insiders.loading}
            error={prices.error}
          />
          <ProfilePanel profile={profile.data} loading={profile.loading} error={profile.error} />
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
          <OptionsPanel ticker={ticker} />
        </main>
      )}

      <footer className="colophon">
        Data: SEC EDGAR (Form 4, 13F-HR, fundamentals), Yahoo Finance (daily OHLCV), CBOE
        (delayed options), Wikipedia (company descriptions).
        Algorithmic-behavior signals are heuristics computed from the daily tape, not tick data.
        Research &amp; education only — not investment advice.
      </footer>
    </div>
  );
}
