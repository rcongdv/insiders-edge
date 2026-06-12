import { useCallback, useEffect, useState } from 'react';

// SEC tickers can include '.' and '-' (BRK-B, BF.B).
const TICKER_RE = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

function parse(pathname) {
  const seg = decodeURIComponent(pathname.replace(/^\/+|\/+$/g, ''));
  return TICKER_RE.test(seg) ? seg.toUpperCase() : null;
}

// Minimal History-API router: '/' is home, '/:ticker' is the dashboard.
// The URL is the single source of truth for which view is shown.
export function useRoute() {
  const [ticker, setTicker] = useState(() => parse(window.location.pathname));

  useEffect(() => {
    // Canonicalize /nvda → /NVDA on first load without adding a history entry.
    const canonical = ticker ? `/${ticker}` : '/';
    if (window.location.pathname !== canonical) history.replaceState(null, '', canonical);
    const onPop = () => setTicker(parse(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = useCallback((next) => {
    const t = next ? parse(`/${String(next)}`) : null;
    const path = t ? `/${t}` : '/';
    if (window.location.pathname !== path) history.pushState(null, '', path);
    setTicker(t);
  }, []);

  return [ticker, navigate];
}
