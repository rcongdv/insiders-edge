import { cachedFetch } from './edgar.js';

// CBOE publishes free delayed option chains (all expirations in one payload).
// It wants dot notation for class shares (BRK.B), and answers 403 — not 404 —
// for unknown or non-optionable symbols.
const cboeSymbol = (ticker) => ticker.toUpperCase().replace(/-/g, '.');
const chainUrl = (ticker) =>
  `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(cboeSymbol(ticker))}.json`;

// OCC option symbols are root + YYMMDD + C/P + strike*1000 (8 digits). Roots
// vary in length and adjusted contracts carry digit suffixes (AAPL1), so parse
// fixed-width from the right.
function parseOcc(option) {
  const tail = option.slice(-15);
  const yy = Number(tail.slice(0, 2));
  const mm = Number(tail.slice(2, 4));
  const dd = Number(tail.slice(4, 6));
  return {
    root: option.slice(0, -15),
    expiration: Date.UTC(2000 + yy, mm - 1, dd) / 1000,
    type: tail[6],
    strike: Number(tail.slice(7)) / 1000,
  };
}

const trimContract = (c, parsed, spot) => ({
  strike: parsed.strike,
  last: c.last_trade_price ?? null,
  bid: c.bid ?? null,
  ask: c.ask ?? null,
  volume: Math.round(c.volume ?? 0),
  oi: Math.round(c.open_interest ?? 0),
  iv: c.iv ?? null,
  itm: spot != null && (parsed.type === 'C' ? parsed.strike < spot : parsed.strike > spot),
});

const emptyChain = () => ({ spot: null, expirations: [], expiration: null, calls: [], puts: [] });

export async function optionsChain(ticker, date) {
  let data;
  try {
    ({ data } = await cachedFetch(chainUrl(ticker), { ttl: 15 * 60_000 }));
  } catch {
    return emptyChain();
  }
  if (!data?.options?.length) return emptyChain();

  const spot = data.current_price ?? data.close ?? null;
  // Adjusted roots (post-split/merger deliverables) would pollute the strike
  // grid and max-pain math — keep only the standard root.
  const root = cboeSymbol(ticker).replace(/\./g, '');
  const contracts = data.options
    .map((c) => ({ c, parsed: parseOcc(c.option) }))
    .filter((x) => x.parsed.root === root);

  const expirations = [...new Set(contracts.map((x) => x.parsed.expiration))].sort((a, b) => a - b);
  // CBOE drops expired contracts from the feed, so the first listed expiration
  // is the nearest live one (expiry epochs are midnight UTC, before the 4pm ET
  // close — don't compare them against the current time).
  const expiration = (date && expirations.includes(date) ? date : null) ?? expirations[0] ?? null;

  const calls = [];
  const puts = [];
  for (const { c, parsed } of contracts) {
    if (parsed.expiration !== expiration) continue;
    (parsed.type === 'C' ? calls : puts).push(trimContract(c, parsed, spot));
  }
  const byStrike = (a, b) => a.strike - b.strike;
  return { spot, expirations, expiration, calls: calls.sort(byStrike), puts: puts.sort(byStrike) };
}
