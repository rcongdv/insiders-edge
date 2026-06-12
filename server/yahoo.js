import { cachedFetch } from './edgar.js';
import { chartMeta } from './prices.js';

// Yahoo's quoteSummary/options APIs require a cookie + "crumb" pair that it
// only issues to browser-looking clients; the v8 chart API does not.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let sessionPromise = null;
let sessionExpires = 0;
let retryAfter = 0;

async function handshake() {
  // fc.yahoo.com answers 404/redirect — only its Set-Cookie header matters.
  const res = await fetch('https://fc.yahoo.com', {
    redirect: 'manual',
    headers: { 'User-Agent': BROWSER_UA },
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!cookie) throw new Error('Yahoo did not return a session cookie');

  const crumbRes = await fetch(
    'https://query1.finance.yahoo.com/v1/test/getcrumb?lang=en-US&region=US',
    { headers: { 'User-Agent': BROWSER_UA, Cookie: cookie } },
  );
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || crumb.includes('<')) {
    throw new Error(`Yahoo crumb handshake failed (${crumbRes.status})`);
  }
  return { cookie, crumb };
}

function getSession() {
  if (!sessionPromise || sessionExpires < Date.now()) {
    // getcrumb rate-limits hard per IP (429s can last a while) — don't let
    // every dashboard view retrigger it after a failure.
    if (Date.now() < retryAfter) {
      return Promise.reject(new Error('Yahoo session cooling down after a failed handshake'));
    }
    sessionExpires = Date.now() + 6 * 60 * 60_000;
    sessionPromise = handshake().catch((err) => {
      sessionPromise = null;
      retryAfter = Date.now() + 5 * 60_000;
      throw err;
    });
  }
  return sessionPromise;
}

// Authed Yahoo GET; a stale session surfaces as 401/403, so re-handshake once.
async function yahooFetch(makeUrl, ttl) {
  let { cookie, crumb } = await getSession();
  const opts = () => ({ ttl, headers: { Cookie: cookie, 'User-Agent': BROWSER_UA } });
  try {
    return await cachedFetch(makeUrl(crumb), opts());
  } catch (err) {
    if (err.upstreamStatus !== 401 && err.upstreamStatus !== 403) throw err;
    sessionPromise = null;
    ({ cookie, crumb } = await getSession());
    return cachedFetch(makeUrl(crumb), opts());
  }
}

// quoteSummary numbers arrive as { raw, fmt }; options numbers come plain.
const num = (x) => (typeof x === 'number' ? x : x?.raw ?? null);

const emptyProfile = () => ({
  summary: null,
  sector: null,
  industry: null,
  employees: null,
  website: null,
  stats: {
    price: null,
    marketCap: null,
    trailingPE: null,
    forwardPE: null,
    eps: null,
    dividendYield: null,
    beta: null,
    avgVolume: null,
    fiftyTwoWeekLow: null,
    fiftyTwoWeekHigh: null,
  },
  source: 'none',
});

export async function companyProfile(ticker) {
  const out = emptyProfile();
  try {
    const sym = encodeURIComponent(ticker.toUpperCase());
    const modules = 'assetProfile,summaryDetail,defaultKeyStatistics,price';
    const body = await yahooFetch(
      (crumb) =>
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`,
      6 * 60 * 60_000,
    );
    const r = body?.quoteSummary?.result?.[0];
    if (!r) throw new Error('empty quoteSummary result');
    const ap = r.assetProfile ?? {};
    const sd = r.summaryDetail ?? {};
    const ks = r.defaultKeyStatistics ?? {};
    const pr = r.price ?? {};
    return {
      summary: ap.longBusinessSummary ?? null,
      sector: ap.sector ?? null,
      industry: ap.industry ?? null,
      employees: ap.fullTimeEmployees ?? null,
      website: ap.website ?? null,
      stats: {
        price: num(pr.regularMarketPrice),
        marketCap: num(pr.marketCap) ?? num(sd.marketCap),
        trailingPE: num(sd.trailingPE),
        forwardPE: num(ks.forwardPE),
        eps: num(ks.trailingEps),
        dividendYield: num(sd.dividendYield),
        beta: num(sd.beta),
        avgVolume: num(sd.averageVolume),
        fiftyTwoWeekLow: num(sd.fiftyTwoWeekLow),
        fiftyTwoWeekHigh: num(sd.fiftyTwoWeekHigh),
      },
      source: 'yahoo',
    };
  } catch {
    // Authed API blocked — the unauthenticated chart meta still has the basics.
    try {
      const meta = await chartMeta(ticker);
      if (meta) {
        out.stats.price = meta.regularMarketPrice ?? null;
        out.stats.fiftyTwoWeekLow = meta.fiftyTwoWeekLow ?? null;
        out.stats.fiftyTwoWeekHigh = meta.fiftyTwoWeekHigh ?? null;
        out.source = 'chart';
      }
    } catch {
      /* keep source: 'none' */
    }
    return out;
  }
}

const trimContract = (c) => ({
  strike: num(c.strike),
  last: num(c.lastPrice),
  bid: num(c.bid),
  ask: num(c.ask),
  volume: num(c.volume) ?? 0,
  oi: num(c.openInterest) ?? 0,
  iv: num(c.impliedVolatility),
  itm: !!c.inTheMoney,
});

// One expiration per call (Yahoo's API shape); no date → nearest expiration.
export async function optionsChain(ticker, date) {
  const sym = encodeURIComponent(ticker.toUpperCase());
  const dateParam = date ? `&date=${encodeURIComponent(date)}` : '';
  let result = null;
  try {
    const body = await yahooFetch(
      (crumb) =>
        `https://query2.finance.yahoo.com/v7/finance/options/${sym}?crumb=${encodeURIComponent(crumb)}${dateParam}`,
      15 * 60_000,
    );
    result = body?.optionChain?.result?.[0];
  } catch {
    /* degrade to an empty chain below */
  }
  const chain = result?.options?.[0];
  return {
    spot: num(result?.quote?.regularMarketPrice),
    expirations: result?.expirationDates ?? [],
    expiration: chain?.expirationDate ?? null,
    calls: (chain?.calls ?? []).map(trimContract),
    puts: (chain?.puts ?? []).map(trimContract),
  };
}
