// Volume anomaly detection over daily OHLCV bars.
// All signals here are heuristics from the daily tape — footprints consistent
// with large/algorithmic participants, not proof of them.

const WINDOW = 60;

const avg = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const std = (xs, mean) =>
  Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length || 1));

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function volumeAnomaly(prices) {
  if (!prices || prices.length < WINDOW + 10) {
    return { series: [], anomalies: [], divergence: null, score: 50, rationale: ['Not enough price history for volume analytics.'] };
  }

  let obv = 0;
  let ad = 0;
  const series = prices.map((p, i) => {
    if (i > 0) {
      const prev = prices[i - 1].close;
      obv += p.close > prev ? p.volume : p.close < prev ? -p.volume : 0;
    }
    const range = p.high - p.low;
    const clv = range > 0 ? (p.close - p.low - (p.high - p.close)) / range : 0;
    ad += clv * p.volume;
    return { date: p.date, obv, ad, clv, z: 0 };
  });

  const anomalies = [];
  for (let i = WINDOW; i < prices.length; i++) {
    const win = prices.slice(i - WINDOW, i);
    const vols = win.map((q) => q.volume);
    const mean = avg(vols);
    const sd = std(vols, mean);
    const z = sd > 0 ? (prices[i].volume - mean) / sd : 0;
    series[i].z = z;
    if (z <= 2.5) continue;

    const p = prices[i];
    const range = p.high - p.low;
    const avgRange = avg(win.map((q) => q.high - q.low));
    let kind, direction, explanation;
    if (range < 0.6 * avgRange) {
      kind = 'absorption';
      direction = series[i].clv >= 0 ? 'up' : 'down';
      explanation =
        'Heavy volume absorbed in an unusually narrow range — consistent with a large passive order working the book rather than news-driven flow.';
    } else if (p.close >= p.open) {
      kind = 'demand burst';
      direction = 'up';
      explanation = 'Volume spike on an up day — aggressive buying interest.';
    } else {
      kind = 'supply burst';
      direction = 'down';
      explanation = 'Volume spike on a down day — aggressive selling pressure.';
    }
    anomalies.push({ date: p.date, z: +z.toFixed(1), kind, direction, explanation });
  }

  // Price/OBV divergence over the trailing 30 sessions.
  const n = prices.length;
  const look = 30;
  const priceChg = prices[n - 1].close / prices[n - 1 - look].close - 1;
  const obvChg = series[n - 1].obv - series[n - 1 - look].obv;
  const obvNorm = obvChg / (avg(prices.slice(n - look).map((p) => p.volume)) * look || 1);
  let divergence = null;
  if (priceChg > 0.02 && obvNorm < -0.05) {
    divergence = {
      type: 'distribution',
      explanation: `Price is up ${(priceChg * 100).toFixed(1)}% over 30 sessions while on-balance volume is falling — rallies are being sold into.`,
    };
  } else if (priceChg < -0.02 && obvNorm > 0.05) {
    divergence = {
      type: 'accumulation',
      explanation: `Price is down ${(priceChg * 100).toFixed(1)}% over 30 sessions while on-balance volume is rising — weakness is being bought.`,
    };
  }

  // Component score.
  let score = 50;
  const rationale = [];
  const lastDate = prices[n - 1].date;
  const recentCutoff = new Date(new Date(lastDate).getTime() - 45 * 86400000)
    .toISOString()
    .slice(0, 10);
  const recent = anomalies.filter((a) => a.date >= recentCutoff);
  const netDir = recent.reduce((s, a) => s + (a.direction === 'up' ? 1 : -1), 0);
  if (recent.length) {
    score += clamp(netDir * 7, -21, 21);
    rationale.push(
      `${recent.length} volume ${recent.length === 1 ? 'anomaly' : 'anomalies'} in the last 45 sessions, net ${netDir >= 0 ? 'buy' : 'sell'}-side.`,
    );
  } else {
    rationale.push('No abnormal volume days in the last 45 sessions.');
  }
  if (divergence) {
    score += divergence.type === 'accumulation' ? 12 : -12;
    rationale.push(divergence.explanation);
  }
  const clv10 = avg(series.slice(-10).map((s) => s.clv));
  score += clamp(clv10 * 18, -12, 12);
  rationale.push(
    `Closes are averaging ${clv10 >= 0 ? 'the upper' : 'the lower'} part of the daily range over the last 10 sessions (CLV ${clv10.toFixed(2)}).`,
  );

  return { series, anomalies, divergence, score: Math.round(clamp(score, 0, 100)), rationale };
}
