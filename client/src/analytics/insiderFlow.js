// Cross-references Form 4 insider filings against the price tape.
// Only open-market transactions (code P = buy, S = sale) carry signal;
// awards, exercises and gifts are excluded from the pressure calculation.

const DAY = 86400000;
const ts = (d) => new Date(d + 'T00:00:00Z').getTime();
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function indexOnOrAfter(prices, date) {
  let lo = 0;
  let hi = prices.length - 1;
  if (!prices.length || prices[hi].date < date) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (prices[mid].date < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function insiderFlow(insiders, prices) {
  const om = (insiders ?? [])
    .filter((t) => (t.code === 'P' || t.code === 'S') && t.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Cluster transactions separated by <= 14 days.
  const clusters = [];
  for (const t of om) {
    const cur = clusters[clusters.length - 1];
    if (cur && ts(t.date) - ts(cur.end) <= 14 * DAY) {
      cur.txns.push(t);
      cur.end = t.date;
    } else {
      clusters.push({ start: t.date, end: t.date, txns: [t] });
    }
  }

  const ret = (i0, k) => {
    if (i0 < 0 || i0 + k >= prices.length) return null;
    return prices[i0 + k].close / prices[i0].close - 1;
  };

  for (const c of clusters) {
    c.buys = c.txns.filter((t) => t.code === 'P').reduce((s, t) => s + t.value, 0);
    c.sells = c.txns.filter((t) => t.code === 'S').reduce((s, t) => s + t.value, 0);
    c.net = c.buys - c.sells;
    c.buyers = new Set(c.txns.filter((t) => t.code === 'P').map((t) => t.owner)).size;
    c.sellers = new Set(c.txns.filter((t) => t.code === 'S').map((t) => t.owner)).size;
    c.clusterBuy = c.buyers >= 3;
    const i0 = indexOnOrAfter(prices, c.end);
    c.fwd5 = ret(i0, 5);
    c.fwd20 = ret(i0, 20);
  }

  // "Did following them work?" — how often did the 20-day move after a
  // cluster match the cluster's net direction.
  const judged = clusters.filter((c) => c.fwd20 != null && c.net !== 0);
  const hitRate = judged.length
    ? judged.filter((c) => Math.sign(c.net) === Math.sign(c.fwd20)).length / judged.length
    : null;

  // Dollar-weighted pressure over the trailing 180 days. Sales are weighted
  // down: insiders sell for many reasons (diversification, taxes) but buy
  // for only one.
  const lastDate = prices[prices.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
  const cutoff = ts(lastDate) - 180 * DAY;
  let buys180 = 0;
  let sells180 = 0;
  for (const t of om) {
    if (ts(t.date) < cutoff) continue;
    if (t.code === 'P') buys180 += t.value;
    else sells180 += t.value;
  }
  const W_SELL = 0.35;
  const denom = buys180 + W_SELL * sells180;
  const ratio = denom > 0 ? (buys180 - W_SELL * sells180) / denom : 0;

  let score = 50 + ratio * (ratio > 0 ? 45 : 30);
  const rationale = [];
  if (!om.length) {
    rationale.push('No open-market insider transactions in the filing window — neutral.');
  } else {
    rationale.push(
      `$${compact(buys180)} of open-market buys vs $${compact(sells180)} of sales in the last 180 days (sales discounted ${Math.round((1 - W_SELL) * 100)}% — often diversification, not conviction).`,
    );
  }
  const recentClusterBuy = clusters.find(
    (c) => c.clusterBuy && ts(c.end) >= ts(lastDate) - 90 * DAY,
  );
  if (recentClusterBuy) {
    score += 8;
    rationale.push(
      `Cluster buy: ${recentClusterBuy.buyers} different insiders bought within the same two-week window ending ${recentClusterBuy.end} — historically the strongest insider signal.`,
    );
  }
  if (hitRate != null) {
    rationale.push(
      `Across ${judged.length} past filing clusters, the 20-day move agreed with insider direction ${Math.round(hitRate * 100)}% of the time.`,
    );
  }

  return {
    score: Math.round(clamp(score, 0, 100)),
    rationale,
    clusters: [...clusters].reverse(),
    hitRate,
    buys180,
    sells180,
    openMarketCount: om.length,
  };
}

function compact(n) {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
