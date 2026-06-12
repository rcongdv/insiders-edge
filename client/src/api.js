import { useEffect, useState } from 'react';

export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let alive = true;
    setState({ data: null, error: null, loading: true });
    fetch(path)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`);
        return body;
      })
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((err) => alive && setState({ data: null, error: err.message, loading: false }));
    return () => {
      alive = false;
    };
  }, [path]);

  return state;
}

const compactFmt = Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const numFmt = Intl.NumberFormat('en-US');

export const fmtMoney = (n) => (n == null ? '—' : '$' + compactFmt.format(n));
export const fmtCompact = (n) => (n == null ? '—' : compactFmt.format(n));
export const fmtNum = (n) => (n == null ? '—' : numFmt.format(Math.round(n)));
export const fmtPct = (x, digits = 1) =>
  x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`;

// Form 4 owner names arrive in EDGAR's "LAST FIRST MIDDLE" caps format.
export const fmtName = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());

export const TXN_CODES = {
  P: { label: 'Open-market buy', cls: 'buy' },
  S: { label: 'Open-market sale', cls: 'sell' },
  A: { label: 'Award / grant', cls: 'plan' },
  M: { label: 'Option exercise', cls: 'plan' },
  F: { label: 'Tax withholding', cls: 'plan' },
  G: { label: 'Gift', cls: 'plan' },
  C: { label: 'Conversion', cls: 'plan' },
  D: { label: 'Disposition', cls: 'sell' },
  J: { label: 'Other', cls: 'plan' },
};
