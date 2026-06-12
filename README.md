# Insider Edge

Stock analysis terminal focused on insider/institutional activity (SEC EDGAR Form 4 + 13F)
with algorithmic-behavior heuristics computed from the daily tape, plus company fundamentals
and options-flow signals from Yahoo Finance. Views are URL-routed (`/NVDA`), so deep links,
bookmarks, and browser back/forward all work.

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
- The fundamentals/options endpoints need Yahoo's cookie+crumb handshake
  (`server/yahoo.js`). If Yahoo blocks it (429), the app degrades gracefully —
  price + 52-week range still show — and retries after a cooldown.
- EDGAR requires the User-Agent contact header set in `server/edgar.js` and
  ~10 req/s max; the built-in cache keeps usage far below that at small scale.
- Research & education only — not investment advice.
