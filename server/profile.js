import { cachedFetch, padCik } from './edgar.js';
import { chartMeta, dailyPrices } from './prices.js';

// Composite company profile: Yahoo's quoteSummary API is crumb-gated and 429s
// non-browser clients, so this stitches the same fields from open sources —
// the v8 chart API (tape), SEC EDGAR (filings), and Wikipedia (description).

const DAY = 24 * 60 * 60_000;
const safe = (p) => p.catch(() => null);

const conceptUrl = (cik, taxonomy, concept) =>
  `https://data.sec.gov/api/xbrl/companyconcept/CIK${padCik(cik)}/${taxonomy}/${concept}.json`;

const durationDays = (e) => (new Date(e.end) - new Date(e.start)) / DAY;

// Later filings restate earlier periods — dedupe by period end, keeping the
// last occurrence (the arrays are filing-ordered).
function dedupeByEnd(entries) {
  const byEnd = new Map();
  for (const e of entries) byEnd.set(e.end, e);
  return [...byEnd.values()].sort((a, b) => new Date(a.end) - new Date(b.end));
}

async function sharesOutstanding(cik) {
  try {
    const body = await cachedFetch(conceptUrl(cik, 'dei', 'EntityCommonStockSharesOutstanding'), {
      ttl: DAY,
    });
    const entries = body?.units?.shares ?? [];
    if (entries.length) return dedupeByEnd(entries).at(-1).val;
  } catch {
    /* multi-class issuers (GOOGL, BRK) tag this per-class — fall through */
  }
  const body = await cachedFetch(
    conceptUrl(cik, 'us-gaap', 'WeightedAverageNumberOfDilutedSharesOutstanding'),
    { ttl: DAY },
  );
  const quarterly = (body?.units?.shares ?? []).filter((e) => {
    const d = durationDays(e);
    return d >= 75 && d <= 105;
  });
  return quarterly.length ? dedupeByEnd(quarterly).at(-1).val : null;
}

// Trailing-twelve-month diluted EPS. The fiscal Q4 is never filed as a 10-Q —
// it only exists inside the 10-K — so synthesize it as annual minus the three
// filed quarters before summing the last four.
async function epsTrailing(cik) {
  const body = await cachedFetch(conceptUrl(cik, 'us-gaap', 'EarningsPerShareDiluted'), {
    ttl: DAY,
  });
  const entries = body?.units?.['USD/shares'] ?? [];
  const quarterly = dedupeByEnd(
    entries.filter((e) => {
      const d = durationDays(e);
      return d >= 75 && d <= 105;
    }),
  );
  const annual = dedupeByEnd(
    entries.filter((e) => {
      const d = durationDays(e);
      return d >= 340 && d <= 380;
    }),
  );

  const fy = annual.at(-1);
  if (fy && !quarterly.some((q) => q.end === fy.end)) {
    const inside = quarterly.filter(
      (q) => new Date(q.start) >= new Date(fy.start) && new Date(q.end) <= new Date(fy.end),
    );
    if (inside.length === 3) {
      quarterly.push({
        start: inside.at(-1).end,
        end: fy.end,
        val: fy.val - inside.reduce((s, q) => s + q.val, 0),
      });
      quarterly.sort((a, b) => new Date(a.end) - new Date(b.end));
    }
  }

  const staleBefore = Date.now() - 400 * DAY;
  const last4 = quarterly.slice(-4);
  const consecutive =
    last4.length === 4 &&
    last4.every(
      (q, i) => i === 0 || (new Date(q.end) - new Date(last4[i - 1].end)) / DAY <= 105,
    ) &&
    new Date(last4.at(-1).end) >= staleBefore;
  if (consecutive) return last4.reduce((s, q) => s + q.val, 0);
  if (fy && new Date(fy.end) >= staleBefore) return fy.val;
  return null;
}

async function edgarSubmissions(cik) {
  const body = await cachedFetch(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`, {
    ttl: DAY,
  });
  return { industry: body?.sicDescription || null, website: body?.website || null };
}

// Business description via Wikipedia: title-search the EDGAR company name,
// then take the page summary extract.
async function wikiSummary(name) {
  // EDGAR names carry registry noise like "PG&E CORP /CA/" or "... CORP NEW".
  const q = name.replace(/\s*\/[A-Z]{2}\/?\s*$/, '').replace(/\s+NEW$/, '').trim();
  const search = await cachedFetch(
    `https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=1`,
    { ttl: DAY },
  );
  const key = search?.pages?.[0]?.key;
  if (!key) return null;
  const page = await cachedFetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key)}`,
    { ttl: DAY },
  );
  // 'standard' excludes disambiguation pages — the main wrong-page hazard.
  return page?.type === 'standard' ? page.extract || null : null;
}

function avgVolume(bars) {
  const recent = (bars ?? []).slice(-30);
  if (recent.length < 5) return null;
  return recent.reduce((s, b) => s + b.volume, 0) / recent.length;
}

function betaVsSpy(bars, spyBars) {
  if (!bars?.length || !spyBars?.length) return null;
  const spyByDate = new Map(spyBars.map((b) => [b.date, b.close]));
  const r = [];
  const m = [];
  let prev = null;
  for (const b of bars) {
    const spy = spyByDate.get(b.date);
    if (spy == null) continue;
    if (prev) {
      r.push(b.close / prev.close - 1);
      m.push(spy / prev.spy - 1);
    }
    prev = { close: b.close, spy };
  }
  if (r.length < 200) return null;
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const rMean = mean(r);
  const mMean = mean(m);
  let cov = 0;
  let varM = 0;
  for (let i = 0; i < r.length; i++) {
    cov += (r[i] - rMean) * (m[i] - mMean);
    varM += (m[i] - mMean) ** 2;
  }
  return varM > 0 ? cov / varM : null;
}

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

export async function companyProfile({ ticker, cik, name }) {
  const [meta, bars, spyBars, submissions, shares, eps, summary] = await Promise.all([
    safe(chartMeta(ticker)),
    safe(dailyPrices(ticker)),
    safe(dailyPrices('SPY')),
    safe(edgarSubmissions(cik)),
    safe(sharesOutstanding(cik)),
    safe(epsTrailing(cik)),
    safe(wikiSummary(name)),
  ]);

  const out = emptyProfile();
  out.summary = summary;
  out.industry = submissions?.industry ?? null;
  out.website = submissions?.website ?? null;

  const s = out.stats;
  s.price = meta?.regularMarketPrice ?? null;
  s.fiftyTwoWeekLow = meta?.fiftyTwoWeekLow ?? null;
  s.fiftyTwoWeekHigh = meta?.fiftyTwoWeekHigh ?? null;
  s.avgVolume = avgVolume(bars);
  s.beta = betaVsSpy(bars, spyBars);
  s.marketCap = shares != null && s.price != null ? shares * s.price : null;
  s.eps = eps;
  s.trailingPE = eps > 0 && s.price != null ? s.price / eps : null;

  if (s.price != null || out.summary || out.industry || s.marketCap != null) {
    out.source = 'composite';
  }
  return out;
}
