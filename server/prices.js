import { cachedFetch } from './edgar.js';

// Yahoo Finance v8 chart API: free daily OHLCV, no API key. (Stooq's CSV
// export now sits behind a JavaScript proof-of-work wall, so it's unusable
// server-side.)
const chartUrl = (ticker) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.toUpperCase())}?range=2y&interval=1d`;

// Same URL (and therefore same cache entry) as dailyPrices — free once the
// dashboard has loaded prices.
export async function chartMeta(ticker) {
  const body = await cachedFetch(chartUrl(ticker), { ttl: 60 * 60_000 });
  return body?.chart?.result?.[0]?.meta ?? null;
}

export async function dailyPrices(ticker) {
  const body = await cachedFetch(chartUrl(ticker), { ttl: 60 * 60_000 });

  const result = body?.chart?.result?.[0];
  if (!result?.timestamp?.length) return [];
  const q = result.indicators?.quote?.[0] ?? {};

  const out = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const close = q.close?.[i];
    if (close == null) continue; // holidays / halted sessions come back null
    // Bars are stamped at the regular-session open (US morning), so the UTC
    // date matches the exchange date.
    out.push({
      date: new Date(result.timestamp[i] * 1000).toISOString().slice(0, 10),
      open: q.open?.[i] ?? close,
      high: q.high?.[i] ?? close,
      low: q.low?.[i] ?? close,
      close,
      volume: q.volume?.[i] ?? 0,
    });
  }
  return out;
}
