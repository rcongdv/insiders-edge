import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { chartMeta } from './prices.js';

// Robinhood's official agentic-trading MCP server. Override for local mock testing.
const MCP_URL = process.env.ROBINHOOD_MCP_URL ?? 'https://agent.robinhood.com/mcp/trading';
const FALLBACK_REDIRECT_URI = 'http://localhost:3001/api/robinhood/callback';

const PORTFOLIO_TTL = 60_000;
const QUOTE_CHUNK = 20; // get_equity_quotes accepts up to 20 symbols per call
const MAX_WATCHLISTS = 6;

const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  return e;
};

// Single-user session, memory only by design: a server restart forgets the
// Robinhood connection entirely and the user re-syncs.
let session = null;

const blankSession = () => ({
  provider: null,
  transport: null,
  client: null,
  redirectUri: FALLBACK_REDIRECT_URI,
  tokens: null,
  clientInfo: null,
  codeVerifier: null,
  state: null,
  pendingAuthUrl: null,
  returnTo: '/',
  tools: [],
  toolNames: [],
  accounts: null,
  portfolioCache: null,
  connected: false,
});

// Server-side OAuthClientProvider: instead of redirecting a browser, it stashes
// the authorization URL for the SPA to navigate to. Tokens live on `session`.
class InMemoryOAuthProvider {
  get redirectUrl() {
    return session.redirectUri;
  }

  get clientMetadata() {
    return {
      client_name: 'Insider Edge',
      redirect_uris: [session.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state() {
    session.state ??= randomUUID();
    return session.state;
  }

  clientInformation() {
    return session.clientInfo ?? undefined;
  }

  saveClientInformation(info) {
    session.clientInfo = info;
  }

  tokens() {
    return session.tokens ?? undefined;
  }

  saveTokens(tokens) {
    session.tokens = tokens;
  }

  redirectToAuthorization(url) {
    session.pendingAuthUrl = url.toString();
  }

  saveCodeVerifier(verifier) {
    session.codeVerifier = verifier;
  }

  codeVerifier() {
    if (!session.codeVerifier) throw new Error('No code verifier saved');
    return session.codeVerifier;
  }

  invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'tokens') session.tokens = null;
    if (scope === 'all' || scope === 'client') session.clientInfo = null;
    if (scope === 'all' || scope === 'verifier') session.codeVerifier = null;
  }
}

async function connectClient() {
  session.transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    authProvider: session.provider,
  });
  session.client = new Client({ name: 'insider-edge', version: '1.0.0' });
  await session.client.connect(session.transport);
}

async function closeClient() {
  try {
    await session?.client?.close();
  } catch {
    /* best effort */
  }
}

async function finishConnect() {
  const { tools } = await session.client.listTools();
  session.tools = tools;
  session.toolNames = tools.map((t) => t.name);
  for (const t of tools) {
    console.log(`[robinhood] tool ${t.name} args=${JSON.stringify(t.inputSchema ?? {})}`);
  }
  session.connected = true;
  session.accounts = null;
  session.portfolioCache = null;
}

// redirectUri is derived per request from the caller's origin (public tunnel
// host, Vite dev origin, or :3001 directly) so Robinhood sends the browser
// back somewhere the user can actually reach. Safe to vary per connect: the
// session reset clears clientInfo, so dynamic client registration re-runs.
export async function beginAuth(returnTo, redirectUri) {
  await closeClient();
  session = blankSession();
  session.returnTo = returnTo || '/';
  session.redirectUri = process.env.ROBINHOOD_REDIRECT_URI ?? redirectUri ?? FALLBACK_REDIRECT_URI;
  session.provider = new InMemoryOAuthProvider();
  try {
    await connectClient();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      // The SDK already ran discovery → registration → PKCE and handed the
      // authorization URL to redirectToAuthorization().
      if (!session.pendingAuthUrl) throw fail(502, 'Robinhood did not provide an authorization URL');
      return { connected: false, authUrl: session.pendingAuthUrl };
    }
    throw fail(502, `Could not reach Robinhood MCP server: ${err.message}`);
  }
  await finishConnect();
  return { connected: true };
}

export function sessionReturnTo() {
  return session?.returnTo ?? '/';
}

export async function completeAuth(code, state) {
  if (!session?.transport) throw fail(400, 'No Robinhood sync in progress');
  if (!state || state !== session.state) throw fail(400, 'OAuth state mismatch');
  session.state = null; // single use
  await session.transport.finishAuth(code);
  // The transport that failed connect with a 401 shouldn't be reused; reconnect fresh.
  await closeClient();
  await connectClient();
  await finishConnect();
}

export function getStatus() {
  return {
    connected: session?.connected ?? false,
    hasWatchlistTool: session?.connected ? !!getTool('get_watchlists', ['watchlist']) : false,
  };
}

export async function disconnect() {
  await closeClient();
  session = null;
}

// ── tool invocation ──────────────────────────────────────────────────────────
// Tool names come from Robinhood's "Trading with your agent" support doc
// (get_accounts, get_equity_positions, get_equity_quotes, get_watchlists,
// get_watchlist_items). Argument names aren't documented, so arguments are
// built from each tool's runtime inputSchema instead of being hardcoded.

function getTool(name, patterns = []) {
  const exact = session.tools.find((t) => t.name === name);
  if (exact) return exact;
  return session.tools.find((t) => patterns.some((p) => t.name.toLowerCase().includes(p)));
}

function argValueFor(prop, def, ctx) {
  const p = prop.toLowerCase();
  if (/account/.test(p) && ctx.accountNumber != null) return ctx.accountNumber;
  if ((/watchlist|list_id/.test(p) || p === 'id') && ctx.watchlistId != null) return ctx.watchlistId;
  if (/cursor/.test(p) && ctx.cursor != null) return ctx.cursor;
  if (/symbol|ticker/.test(p) && ctx.symbols != null) {
    // JSON-Schema `type` may be a union array, e.g. ["null","array"] on the real server.
    const types = [].concat(def?.type ?? []);
    return types.includes('array') || !types.length ? ctx.symbols : ctx.symbols.join(',');
  }
  return undefined;
}

function buildArgs(tool, ctx = {}) {
  const schema = tool.inputSchema ?? {};
  const args = {};
  for (const [prop, def] of Object.entries(schema.properties ?? {})) {
    const v = argValueFor(prop, def, ctx);
    if (v !== undefined) args[prop] = v;
  }
  for (const prop of schema.required ?? []) {
    if (args[prop] === undefined) {
      throw fail(502, `Robinhood tool "${tool.name}" requires argument "${prop}" which Insider Edge doesn't know how to supply`);
    }
  }
  return args;
}

async function callTool(tool, ctx) {
  const result = await session.client.callTool({ name: tool.name, arguments: buildArgs(tool, ctx) });
  const parsed = parseToolResult(result);
  console.log(`[robinhood] ${tool.name} → ${(JSON.stringify(parsed) ?? 'null').slice(0, 600)}`);
  return parsed;
}

// Read-only escape hatch for /api/robinhood/raw: inspect exact payload shapes.
export async function rawTool(name, query = {}) {
  if (!session?.connected) throw fail(401, 'Not connected to Robinhood — sync first');
  if (!/^get_|^search$/.test(name)) throw fail(400, 'Only read-only get_* / search tools allowed');
  const tool = session.tools.find((t) => t.name === name);
  if (!tool) throw fail(404, `No such tool "${name}" (tools: ${session.toolNames.join(', ')})`);
  const args = {};
  for (const [prop, def] of Object.entries(tool.inputSchema?.properties ?? {})) {
    if (query[prop] == null) continue;
    const types = [].concat(def?.type ?? []);
    args[prop] = types.includes('array') ? String(query[prop]).split(',') : String(query[prop]);
  }
  return parseToolResult(await session.client.callTool({ name, arguments: args }));
}

function parseToolResult(result) {
  if (result.isError) {
    const text = (result.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ');
    throw fail(502, `Robinhood tool error: ${text || 'unknown error'}`);
  }
  if (result.structuredContent != null) return result.structuredContent;
  for (const block of result.content ?? []) {
    if (block.type !== 'text') continue;
    try {
      return JSON.parse(block.text);
    } catch {
      /* not JSON — try the next block */
    }
  }
  return null;
}

// ── payload normalization ────────────────────────────────────────────────────
// Response shapes are unverified, so unwrap and map defensively.

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const pick = (obj, keys) => keys.map((k) => obj?.[k]).find((v) => v != null);

function extractList(raw) {
  if (Array.isArray(raw)) return raw;
  for (const key of [
    'results', 'positions', 'holdings', 'items', 'data',
    'accounts', 'quotes', 'watchlists', 'lists', 'entries',
  ]) {
    if (Array.isArray(raw?.[key])) return raw[key];
  }
  return [];
}

const pickSymbol = (o) => {
  const s = typeof o === 'string' ? o : pick(o, ['symbol', 'instrument_symbol', 'ticker']);
  return s ? String(s).toUpperCase() : null;
};

const SYMBOL_KEY_RE = /^(symbol|instrument_symbol|ticker)$/i;
const MAX_DEPTH = 8;

// Collect primitive values stored under keys matching keyRe, anywhere in the tree.
function collectDeep(node, keyRe, out = [], depth = 0) {
  if (node == null || depth > MAX_DEPTH) return out;
  if (Array.isArray(node)) {
    for (const item of node) collectDeep(item, keyRe, out, depth + 1);
  } else if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (keyRe.test(k) && (typeof v === 'string' || typeof v === 'number')) out.push(String(v));
      else collectDeep(v, keyRe, out, depth + 1);
    }
  }
  return out;
}

// Find all arrays (anywhere in the tree) whose object elements contain a key
// matching keyRe at any depth — quote rows nest the symbol one level down
// ({quote: {symbol…}, close: {…}}), so a top-level-key check would miss them.
function findRowsDeep(node, keyRe, out = [], depth = 0) {
  if (node == null || depth > MAX_DEPTH) return out;
  if (Array.isArray(node)) {
    const objs = node.filter((el) => el && typeof el === 'object' && !Array.isArray(el));
    if (objs.some((el) => collectDeep(el, keyRe).length)) out.push(...objs);
    else for (const el of node) findRowsDeep(el, keyRe, out, depth + 1);
  } else if (typeof node === 'object') {
    for (const v of Object.values(node)) findRowsDeep(v, keyRe, out, depth + 1);
  }
  return out;
}

// Paginated tools point to the next page via a `next` URL or bare cursor.
function nextCursor(raw, seen) {
  for (const v of collectDeep(raw, /^(next|next_url|next_cursor|cursor)$/i)) {
    let cursor = v;
    if (/^https?:/i.test(v)) {
      try {
        cursor = new URL(v).searchParams.get('cursor');
      } catch {
        cursor = null;
      }
    }
    if (cursor && !seen.has(cursor)) return cursor;
  }
  return null;
}

// Positions arrive per account; merge per symbol (sum shares, weighted avg cost).
export function mergePositions(rows) {
  const bySymbol = new Map();
  for (const row of rows) {
    const symbol = pickSymbol(row);
    if (!symbol) continue;
    const quantity = num(pick(row, ['quantity', 'shares', 'open_quantity'])) ?? 0;
    const avgCost = num(
      pick(row, ['average_buy_price', 'avg_cost', 'average_cost', 'cost_basis_per_share', 'average_cost_basis']),
    );
    const marketValue = num(pick(row, ['market_value', 'equity', 'value']));
    const prev = bySymbol.get(symbol) ?? { symbol, quantity: 0, costBasis: 0, costKnown: true, marketValue: null };
    prev.quantity += quantity;
    if (avgCost != null) prev.costBasis += avgCost * quantity;
    else prev.costKnown = false;
    if (marketValue != null) prev.marketValue = (prev.marketValue ?? 0) + marketValue;
    bySymbol.set(symbol, prev);
  }
  return [...bySymbol.values()].filter((p) => p.quantity > 0);
}

export function finalizePositions(merged, quotes) {
  return merged
    .map((p) => {
      let price = quotes.get(p.symbol) ?? null;
      const marketValue = p.marketValue ?? (price != null ? price * p.quantity : null);
      if (price == null && marketValue != null && p.quantity) price = marketValue / p.quantity;
      const costBasis = p.costKnown ? p.costBasis : null;
      const avgCost = costBasis != null ? costBasis / p.quantity : null;
      const pnl = marketValue != null && costBasis != null ? marketValue - costBasis : null;
      const pnlPct = pnl != null && costBasis ? pnl / costBasis : null;
      return { symbol: p.symbol, quantity: p.quantity, price, avgCost, marketValue, pnl, pnlPct };
    })
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
}

// ── portfolio pipeline: accounts → positions → quotes → watchlists ──────────

async function fetchAccountNumbers() {
  if (session.accounts?.length) return session.accounts;
  const tool = getTool('get_accounts', ['account']);
  if (!tool) {
    throw fail(502, `No accounts tool on Robinhood MCP server (tools: ${session.toolNames.join(', ')})`);
  }
  const raw = await callTool(tool, {});
  // Include every readable account: agentic_allowed only gates trading, and the
  // user's holdings live in the regular (non-agentic) brokerage accounts.
  // Skip only dead accounts, and never filter down to zero.
  let rows = findRowsDeep(raw, /account_?number/i);
  const usable = rows.filter((a) => a.deactivated !== true && a.permanently_deactivated !== true);
  if (usable.length) rows = usable;
  let numbers = collectDeep(rows.length ? rows : raw, /account_?number/i);
  if (!numbers.length) numbers = collectDeep(raw, /^number$/i);
  numbers = [...new Set(numbers)];
  if (!numbers.length) {
    console.warn(`[robinhood] could not extract account numbers from: ${JSON.stringify(raw)}`);
    throw fail(502, 'Could not extract account numbers from get_accounts — see server log for the raw payload');
  }
  session.accounts = numbers;
  return numbers;
}

// Real payload (captured): {data: {results: [{quote: {…prices}, close: {price}}]}}.
// Per its embedded guide: current price is whichever of last_trade_price /
// last_non_reg_trade_price has the more recent venue timestamp.
function quotePrice(row) {
  const q = row.quote && typeof row.quote === 'object' ? row.quote : row;
  const reg = num(q.last_trade_price);
  const nonReg = num(q.last_non_reg_trade_price);
  if (reg != null && nonReg != null) {
    const regAt = Date.parse(q.venue_last_trade_time ?? '') || 0;
    const nonRegAt = Date.parse(q.venue_last_non_reg_trade_time ?? '') || 0;
    return nonRegAt > regAt ? nonReg : reg;
  }
  if (reg != null || nonReg != null) return reg ?? nonReg;
  const generic = num(pick(q, ['last_price', 'price', 'mark', 'last']));
  if (generic != null) return generic;
  const ask = num(q.ask_price);
  const bid = num(q.bid_price);
  if (ask && bid) return (ask + bid) / 2;
  return num(q.previous_close) ?? num(row.close?.price);
}

async function fetchQuotes(symbols) {
  const map = new Map();
  const tool = getTool('get_equity_quotes', ['quote']);
  if (!tool || !symbols.length) return map;
  try {
    for (let i = 0; i < symbols.length; i += QUOTE_CHUNK) {
      const raw = await callTool(tool, { symbols: symbols.slice(i, i + QUOTE_CHUNK) });
      for (const row of findRowsDeep(raw, SYMBOL_KEY_RE)) {
        const symbol = pickSymbol(row.quote && typeof row.quote === 'object' ? row.quote : row) ?? pickSymbol(row);
        const price = quotePrice(row);
        if (symbol && price != null && !map.has(symbol)) map.set(symbol, price);
      }
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    console.warn(`[robinhood] quotes fetch failed: ${err.message}`);
  }
  return map;
}

// Anything Robinhood won't quote falls back to Yahoo's chart meta (shared 1h cache).
async function fillMissingQuotes(symbols, quotes) {
  const missing = symbols.filter((s) => !quotes.has(s));
  await Promise.all(
    missing.map(async (symbol) => {
      try {
        const meta = await chartMeta(symbol);
        const price = num(meta?.regularMarketPrice ?? meta?.previousClose ?? meta?.chartPreviousClose);
        if (price != null) quotes.set(symbol, price);
      } catch {
        /* symbol stays unpriced — UI renders “—” */
      }
    }),
  );
}

async function fetchWatchlists(accountNumber) {
  const listTool = getTool('get_watchlists', ['watchlist']);
  if (!listTool) return null;
  try {
    const rawLists = await callTool(listTool, { accountNumber });
    let lists = extractList(rawLists);
    if (!lists.length) lists = findRowsDeep(rawLists, /^(list_)?id$|^(display_)?name$/i);
    const itemsTool = getTool('get_watchlist_items', ['watchlist_item']);
    const out = [];
    for (const list of lists.slice(0, MAX_WATCHLISTS)) {
      if (!list || typeof list !== 'object') continue;
      if (list.item_count === 0) continue;
      const baseName = String(pick(list, ['display_name', 'name', 'title']) ?? 'Watchlist');
      const name = list.icon_emoji ? `${list.icon_emoji} ${baseName}` : baseName;
      // One incompatible list (e.g. the special options watchlist rejects the
      // items call with a 400) must not sink the others.
      try {
        // Symbols may be inlined on the list; otherwise fetch them per watchlist.
        // Items mix asset types (object_type: instrument/currency_pair/index) —
        // collecting `symbol` keys naturally keeps equities and skips UUID-only entries.
        let symbols = collectDeep(list, SYMBOL_KEY_RE);
        if (!symbols.length && itemsTool) {
          const id = pick(list, ['id', 'list_id', 'watchlist_id', 'uuid']);
          if (id != null) {
            const raw = await callTool(itemsTool, { watchlistId: String(id), accountNumber });
            symbols = collectDeep(raw, SYMBOL_KEY_RE);
          }
        }
        symbols = [...new Set(symbols.map((s) => s.toUpperCase()))];
        if (symbols.length) out.push({ name, symbols });
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
        console.warn(`[robinhood] watchlist "${baseName}" skipped: ${err.message}`);
      }
    }
    return out;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    console.warn(`[robinhood] watchlist fetch failed: ${err.message}`);
    return null;
  }
}

export async function fetchPortfolio({ refresh = false } = {}) {
  if (!session?.connected) throw fail(401, 'Not connected to Robinhood — sync first');
  const cache = session.portfolioCache;
  if (!refresh && cache && Date.now() - cache.at < PORTFOLIO_TTL) return cache.data;

  try {
    const accounts = await fetchAccountNumbers();

    const positionsTool = getTool('get_equity_positions', ['position', 'holding']);
    if (!positionsTool) {
      throw fail(502, `No positions tool found on Robinhood MCP server (tools: ${session.toolNames.join(', ')})`);
    }
    // Per-account fault tolerance: one unreadable account (e.g. inactive)
    // shouldn't sink the rest — but if every account fails, surface the error.
    const rows = [];
    const accountErrors = [];
    for (const accountNumber of accounts) {
      try {
        let cursor;
        const seen = new Set();
        for (let page = 0; page < 10; page++) {
          const raw = await callTool(positionsTool, { accountNumber, cursor });
          let pageRows = extractList(raw);
          if (!pageRows.length) pageRows = findRowsDeep(raw, SYMBOL_KEY_RE);
          rows.push(...pageRows);
          cursor = nextCursor(raw, seen);
          if (!cursor) break;
          seen.add(cursor);
        }
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
        console.warn(`[robinhood] positions fetch failed for account ${accountNumber}: ${err.message}`);
        accountErrors.push(err);
      }
    }
    if (accountErrors.length === accounts.length) throw accountErrors[0];
    const merged = mergePositions(rows);

    // Quotes and watchlists are best-effort enrichment; failures never sink the response.
    const symbols = merged.map((p) => p.symbol);
    const quotes = await fetchQuotes(symbols);
    await fillMissingQuotes(symbols, quotes);
    const watchlists = await fetchWatchlists(accounts[0]);

    const data = {
      connected: true,
      fetchedAt: new Date().toISOString(),
      positions: finalizePositions(merged, quotes),
      watchlists,
    };
    session.portfolioCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      await disconnect();
      throw fail(401, 'Robinhood session expired — sync again');
    }
    throw err;
  }
}
