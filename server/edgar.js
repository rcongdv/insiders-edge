// SEC requires a User-Agent identifying the requester, and ~10 req/s max.
const USER_AGENT = 'insider-edge research tool richardcong635@gmail.com';

const cache = new Map(); // url -> { expires, data }

export async function cachedFetch(url, { ttl = 15 * 60_000, as = 'json', headers = {} } = {}) {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.data;

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });
  if (!res.ok) {
    const host = new URL(url).host;
    const hint =
      res.status === 403 && host.endsWith('sec.gov')
        ? ' (EDGAR returns 403 when the User-Agent contact header is missing or rate limits are exceeded)'
        : '';
    const err = new Error(`Upstream ${res.status} from ${host}${hint}`);
    err.upstreamStatus = res.status;
    throw err;
  }
  const data = as === 'json' ? await res.json() : await res.text();
  cache.set(url, { expires: Date.now() + ttl, data });
  return data;
}

// Run fn over items with bounded concurrency; individual failures yield null.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch {
        results[i] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

let tickersPromise = null;

export function allTickers() {
  tickersPromise ??= cachedFetch('https://www.sec.gov/files/company_tickers.json', {
    ttl: 24 * 60 * 60_000,
  })
    .then((raw) =>
      Object.values(raw).map((c) => ({ ticker: c.ticker, cik: c.cik_str, name: c.title })),
    )
    .catch((err) => {
      tickersPromise = null;
      throw err;
    });
  return tickersPromise;
}

export async function resolveTicker(ticker) {
  const t = String(ticker).toUpperCase().trim();
  const list = await allTickers();
  return list.find((c) => c.ticker === t) ?? null;
}

export const padCik = (cik) => String(cik).padStart(10, '0');
