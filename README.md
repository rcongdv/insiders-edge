# Insider Edge

Stock analysis terminal focused on insider/institutional activity (SEC EDGAR Form 4 + 13F)
with algorithmic-behavior heuristics computed from the daily tape, company fundamentals
(SEC XBRL + Yahoo + Wikipedia), and options-flow signals from CBOE's free delayed feed.
The home screen can also sync your Robinhood positions and watchlists (see below).
Views are URL-routed (`/NVDA`), so deep links, bookmarks, and browser back/forward all work.

## Develop

```sh
npm install
npm run dev        # API on :3001, Vite dev server on :5173
```

## Run in production (single process)

```sh
npm run build      # builds the SPA into dist/
npm start          # serves the app AND the API on http://localhost:3001
```

Set `PORT` to serve on a different port (defaults to 3001).

## Robinhood sync

The home screen's **Sync with Robinhood** button pulls your positions (with live
prices and P&L) and watchlists through Robinhood's official agentic MCP server
(`https://agent.robinhood.com/mcp/trading`) — the Express server acts as an MCP
client and runs a standard OAuth flow (dynamic client registration + PKCE).

- **Read-only.** Only `get_*` tools are ever called; order-placing tools are never used.
- **Session-only.** Tokens and synced data live in server memory — a restart forgets
  the connection and you just re-sync. Nothing is written to disk.
- **First sync** requires approving an Agentic account on robinhood.com, which
  Robinhood only allows from a desktop browser.
- Position prices come from Robinhood quotes; symbols Robinhood won't quote fall
  back to Yahoo's chart API.

The OAuth callback URL is derived automatically from wherever you click Sync —
the public tunnel hostname, the Vite dev origin, or localhost — so remote hosting
works without configuration.

Environment overrides:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ROBINHOOD_MCP_URL` | `https://agent.robinhood.com/mcp/trading` | Point at a mock MCP server for testing |
| `ROBINHOOD_REDIRECT_URI` | auto-derived from the connect request | Force a fixed OAuth callback URL for unusual proxy setups that don't forward `Host`/`X-Forwarded-*` headers |

Debugging: with a live session, `GET /api/robinhood/raw?tool=get_accounts` (read-only
`get_*`/`search` tools only, tool arguments as query params) returns the raw parsed
payload, and the server logs every tool call's response (truncated) plus each tool's
input schema on connect.

## Hosting on a home Mac mini

### 1. Keep the machine awake

System Settings → Energy → enable "Prevent automatic sleeping when the display is off"
(or `sudo pmset -a sleep 0`). Display sleep is fine; system sleep kills the server.

### 2. Run it as a service (launchd)

Create `~/Library/LaunchAgents/com.insideredge.plist` (adjust the two paths;
`which node` tells you the node path):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.insideredge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>server/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/YOU/insiders</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/insider-edge.log</string>
  <key>StandardErrorPath</key><string>/tmp/insider-edge.log</string>
</dict>
</plist>
```

```sh
launchctl load ~/Library/LaunchAgents/com.insideredge.plist
```

It now starts on boot and restarts if it crashes. After pulling changes:
`npm run build && launchctl kickstart -k gui/$(id -u)/com.insideredge`.

### 3. Let friends reach it (pick one)

**Tailscale Funnel** — no domain, no router changes, free:

```sh
brew install tailscale && tailscale up
tailscale funnel 3001
```

You get a stable public `https://your-mini.your-tailnet.ts.net` URL with automatic
TLS. Friends need nothing installed. (Without Funnel, plain Tailscale also works if
friends join your tailnet — tighter access control.)

**Cloudflare Tunnel** — if you own a domain and want `insiders.yourdomain.com`:

```sh
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create insider-edge
cloudflared tunnel route dns insider-edge insiders.yourdomain.com
cloudflared tunnel run --url http://localhost:3001 insider-edge
```

Both options avoid port forwarding and never expose your home IP.

### Notes

- Yahoo Finance occasionally rate-limits; from a residential IP this is rare
  (datacenter IPs have it much worse — one reason home hosting suits this app).
  Prices use Yahoo's keyless v8 chart API (`server/prices.js`); if Yahoo blocks
  it, profiles degrade gracefully and the cache retries after the TTL.
- Options data comes from CBOE's free delayed chain (`server/cboe.js`) — no key.
- EDGAR requires the User-Agent contact header set in `server/edgar.js` and
  ~10 req/s max; the built-in cache keeps usage far below that at small scale.
- Research & education only — not investment advice.
