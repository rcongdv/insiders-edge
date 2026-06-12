import { useState } from 'react';
import { fmtCompact, fmtMoney } from '../api.js';

const usd = (n, digits = 2) => (n == null ? '—' : `$${n.toFixed(digits)}`);
const ratio = (n, digits = 1) => (n == null ? '—' : n.toFixed(digits));

function Stat({ label, value }) {
  return (
    <div className="stat-cell">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export default function ProfilePanel({ profile, loading, error }) {
  const [expanded, setExpanded] = useState(false);

  const s = profile?.stats ?? {};
  const meta =
    profile &&
    [
      profile.sector,
      profile.industry,
      profile.employees != null && `${fmtCompact(profile.employees)} employees`,
    ]
      .filter(Boolean)
      .join(' · ');
  const rangePos =
    s.price != null && s.fiftyTwoWeekLow != null && s.fiftyTwoWeekHigh > s.fiftyTwoWeekLow
      ? Math.min(1, Math.max(0, (s.price - s.fiftyTwoWeekLow) / (s.fiftyTwoWeekHigh - s.fiftyTwoWeekLow)))
      : null;

  return (
    <section className="panel" style={{ '--d': '60ms' }}>
      <div className="panel-head">
        <h3>Company profile</h3>
        {meta && <span className="panel-stat">{meta}</span>}
      </div>

      {error ? (
        <div className="panel-error">{error}</div>
      ) : loading ? (
        <div className="skeleton-rows">
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
        </div>
      ) : !profile || profile.source === 'none' ? (
        <p className="empty-note">Company fundamentals are unavailable right now.</p>
      ) : (
        <div className="profile-body">
          <div className="profile-about">
            {profile.summary ? (
              <>
                <p className={`profile-summary${expanded ? ' expanded' : ''}`}>{profile.summary}</p>
                <div className="profile-about-foot">
                  <button className="chip chip-btn toggle-btn" onClick={() => setExpanded(!expanded)}>
                    {expanded ? '[ less ]' : '[ more ]'}
                  </button>
                  {profile.website && (
                    <a className="profile-link" href={profile.website} target="_blank" rel="noreferrer">
                      {profile.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} ↗
                    </a>
                  )}
                </div>
              </>
            ) : (
              <p className="empty-note">
                Business description unavailable — extended fundamentals are blocked upstream;
                showing tape-derived stats only.
              </p>
            )}
          </div>

          <div className="profile-stats">
            <div className="stat-grid">
              <Stat label="last" value={usd(s.price)} />
              <Stat label="mkt cap" value={fmtMoney(s.marketCap)} />
              <Stat label="p/e ttm" value={ratio(s.trailingPE)} />
              <Stat label="fwd p/e" value={ratio(s.forwardPE)} />
              <Stat label="eps ttm" value={usd(s.eps)} />
              <Stat
                label="div yield"
                value={s.dividendYield == null ? '—' : `${(s.dividendYield * 100).toFixed(2)}%`}
              />
              <Stat label="beta" value={ratio(s.beta, 2)} />
              <Stat label="avg vol" value={fmtCompact(s.avgVolume)} />
            </div>
            {rangePos != null && (
              <div className="range-meter">
                <span className="range-label">52w {usd(s.fiftyTwoWeekLow)}</span>
                <div className="meter range-track">
                  <div className="range-tick" style={{ left: `${rangePos * 100}%` }} />
                </div>
                <span className="range-label">{usd(s.fiftyTwoWeekHigh)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
