import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allTickers, resolveTicker } from './edgar.js';
import { insiderTransactions } from './form4.js';
import { institutionalHolders } from './thirteenF.js';
import { dailyPrices } from './prices.js';
import { companyProfile } from './profile.js';
import { optionsChain } from './cboe.js';
import {
  beginAuth,
  completeAuth,
  disconnect,
  fetchPortfolio,
  getStatus,
  rawTool,
  sessionReturnTo,
} from './robinhood.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(err.status ?? 502).json({ error: err.message });
  }
};

const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  return e;
};

async function requireCompany(req) {
  const c = await resolveTicker(req.params.ticker);
  if (!c) throw fail(404, `Unknown ticker "${req.params.ticker}" — not in SEC's registry`);
  return c;
}

app.get(
  '/api/search',
  wrap(async (req) => {
    const q = String(req.query.q ?? '').trim().toUpperCase();
    if (!q) return [];
    const list = await allTickers();
    return list
      .map((c) => ({
        c,
        rank: c.ticker === q ? 0 : c.ticker.startsWith(q) ? 1 : c.name.toUpperCase().includes(q) ? 2 : 3,
      }))
      .filter((x) => x.rank < 3)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 8)
      .map((x) => x.c);
  }),
);

app.get(
  '/api/prices/:ticker',
  wrap(async (req) => {
    const company = await requireCompany(req);
    const prices = await dailyPrices(company.ticker);
    if (!prices.length) throw fail(404, `No price history found for ${company.ticker} on Stooq`);
    return prices;
  }),
);

app.get(
  '/api/profile/:ticker',
  wrap(async (req) => {
    const company = await requireCompany(req);
    // SEC name/cik always resolve; the composite profile degrades gracefully.
    return { ...company, ...(await companyProfile(company)) };
  }),
);

app.get(
  '/api/options/:ticker',
  wrap(async (req) => {
    const company = await requireCompany(req);
    const date = /^\d+$/.test(String(req.query.date ?? '')) ? Number(req.query.date) : undefined;
    return optionsChain(company.ticker, date);
  }),
);

app.get(
  '/api/insiders/:ticker',
  wrap(async (req) => {
    const company = await requireCompany(req);
    return insiderTransactions(company.cik);
  }),
);

app.get(
  '/api/institutional/:ticker',
  wrap(async (req) => {
    const company = await requireCompany(req);
    return { holders: await institutionalHolders(company.name), sampled: true };
  }),
);

// Robinhood sync — the server is an MCP client to Robinhood's agentic API.
// Tokens and portfolio data are held in memory only (session-only by design).
app.post(
  '/api/robinhood/connect',
  wrap(async (req) => beginAuth(req.get('referer') ?? '/')),
);

// OAuth callback must redirect the browser back to the SPA, so no `wrap`.
app.get('/api/robinhood/callback', async (req, res) => {
  const { code, state, error, error_description: desc } = req.query;
  const back = (q) => res.redirect(`${sessionReturnTo()}?${q}`);
  if (error) return back(`rh=error&msg=${encodeURIComponent(String(desc ?? error))}`);
  try {
    await completeAuth(String(code ?? ''), String(state ?? ''));
    back('rh=connected');
  } catch (err) {
    back(`rh=error&msg=${encodeURIComponent(err.message)}`);
  }
});

app.get('/api/robinhood/status', wrap(async () => getStatus()));

app.get(
  '/api/robinhood/portfolio',
  wrap(async (req) => fetchPortfolio({ refresh: 'refresh' in req.query })),
);

// Debug: inspect a read-only tool's raw payload, e.g.
//   /api/robinhood/raw?tool=get_accounts
//   /api/robinhood/raw?tool=get_equity_positions&account_number=XXX
app.get(
  '/api/robinhood/raw',
  wrap(async (req) => {
    const { tool, ...args } = req.query;
    if (!tool) throw fail(400, 'Pass ?tool=get_accounts (plus any tool arguments)');
    return rawTool(String(tool), args);
  }),
);

app.post(
  '/api/robinhood/disconnect',
  wrap(async () => {
    await disconnect();
    return getStatus();
  }),
);

// In production (after `npm run build`) the same process serves the SPA.
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[api] insider-edge listening on http://localhost:${PORT}`);
});
