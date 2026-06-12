// Algorithmic-execution signatures inferred from daily bars: footprints
// consistent with scheduled execution (VWAP/TWAP), close-targeting programs,
// and iceberg-style stealth accumulation. Daily data can only suggest these
// patterns — the UI presents them as heuristics, not facts.

const LOOKBACK = 60;

const avg = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const std = (xs, mean) =>
  Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length || 1));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function rollingMean(values, window) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window) out[i] = sum / window;
  }
  return out;
}

export function execPatterns(prices) {
  if (!prices || prices.length < LOOKBACK + 15) {
    return { signatures: [], score: 50, rationale: ['Not enough price history for execution-pattern analysis.'] };
  }

  const n = prices.length;
  const vols = prices.map((p) => p.volume);
  const ranges = prices.map((p) => p.high - p.low);
  const avgVol = rollingMean(vols, LOOKBACK);
  const avgRange = rollingMean(ranges, LOOKBACK);
  const clv = prices.map((p) =>
    p.high > p.low ? (p.close - p.low - (p.high - p.close)) / (p.high - p.low) : 0,
  );

  const signatures = [];

  // 1. Close-pinning streaks: runs of closes in the top/bottom 20% of the
  // daily range — the footprint of end-of-day buy/sell programs.
  for (const side of [1, -1]) {
    let run = 0;
    for (let i = LOOKBACK; i <= n; i++) {
      const inRun = i < n && clv[i] * side > 0.6;
      if (inRun) {
        run++;
        continue;
      }
      if (run >= 4) {
        signatures.push({
          type: 'Close-pinning',
          direction: side > 0 ? 'accumulation' : 'distribution',
          start: prices[i - run].date,
          end: prices[i - 1].date,
          confidence: clamp(run / 8, 0.4, 1),
          explanation: `${run} consecutive closes in the ${side > 0 ? 'top' : 'bottom'} 20% of the daily range — consistent with end-of-day ${side > 0 ? 'buy' : 'sell'} programs (MOC / target-close algos).`,
        });
      }
      run = 0;
    }
  }

  // 2. Stealth accumulation/distribution: stretches of elevated volume with
  // compressed ranges and a one-way drift — iceberg/TWAP-style footprints.
  const WIN = 5;
  let lastEnd = -1;
  for (let i = LOOKBACK + WIN; i < n; i++) {
    if (i <= lastEnd) continue;
    let ok = true;
    for (let j = i - WIN + 1; j <= i; j++) {
      if (!(vols[j] > 1.05 * avgVol[j] && ranges[j] < 0.9 * avgRange[j])) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const drift = prices[i].close / prices[i - WIN].close - 1;
    if (Math.abs(drift) < 0.005) continue;
    signatures.push({
      type: 'Stealth flow',
      direction: drift > 0 ? 'accumulation' : 'distribution',
      start: prices[i - WIN + 1].date,
      end: prices[i].date,
      confidence: clamp(0.4 + Math.abs(drift) * 8, 0.4, 0.9),
      explanation: `${WIN} straight sessions of above-average volume inside below-average ranges while price drifted ${(drift * 100).toFixed(1)}% — the signature of an iceberg/TWAP order being worked quietly.`,
    });
    lastEnd = i + WIN - 1;
  }

  // 3. Volume regularity: unusually uniform daily volume while price trends —
  // bursty volume implies news flow, uniform volume implies a schedule.
  const RWIN = 10;
  lastEnd = -1;
  for (let i = LOOKBACK + RWIN; i < n; i++) {
    if (i <= lastEnd) continue;
    const w = vols.slice(i - RWIN + 1, i + 1);
    const m = avg(w);
    const cv = m > 0 ? std(w, m) / m : 1;
    const trend = prices[i].close / prices[i - RWIN].close - 1;
    if (cv < 0.22 && Math.abs(trend) > 0.025) {
      signatures.push({
        type: 'Scheduled execution',
        direction: trend > 0 ? 'accumulation' : 'distribution',
        start: prices[i - RWIN + 1].date,
        end: prices[i].date,
        confidence: clamp(0.5 + (0.22 - cv), 0.5, 0.85),
        explanation: `Volume varied only ±${Math.round(cv * 100)}% across ${RWIN} sessions while price moved ${(trend * 100).toFixed(1)}% — uniform participation typical of VWAP/percent-of-volume schedules, not news-driven trading.`,
      });
      lastEnd = i + RWIN - 1;
    }
  }

  signatures.sort((a, b) => b.end.localeCompare(a.end));

  // Component score from signatures ending in the last 60 sessions.
  const lastDate = prices[n - 1].date;
  const cutoff = new Date(new Date(lastDate).getTime() - 60 * 86400000)
    .toISOString()
    .slice(0, 10);
  let score = 50;
  const rationale = [];
  const recent = signatures.filter((s) => s.end >= cutoff);
  for (const s of recent) {
    const age = (new Date(lastDate) - new Date(s.end)) / 86400000;
    const recency = 1 - (age / 60) * 0.5;
    score += s.confidence * 16 * (s.direction === 'accumulation' ? 1 : -1) * recency;
  }
  if (recent.length) {
    const acc = recent.filter((s) => s.direction === 'accumulation').length;
    rationale.push(
      `${recent.length} execution signature${recent.length === 1 ? '' : 's'} in the last 60 sessions (${acc} accumulation, ${recent.length - acc} distribution).`,
    );
  } else {
    rationale.push('No algorithmic execution signatures detected recently — flow looks discretionary/news-driven.');
  }

  return { signatures, score: Math.round(clamp(score, 0, 100)), rationale };
}
