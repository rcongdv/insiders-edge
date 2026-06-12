import { XMLParser } from 'fast-xml-parser';
import { cachedFetch, mapLimit } from './edgar.js';

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

const CANON = { CORPORATION: 'CORP', INCORPORATED: 'INC', COMPANY: 'CO', LIMITED: 'LTD' };
const norm = (s) =>
  String(s)
    .toUpperCase()
    .replace(/[.,'\/&]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => CANON[w] ?? w)
    .join(' ');

// True when the shorter name is a token-prefix of the longer and they differ by
// at most one trailing suffix word ("NVIDIA" vs "NVIDIA CORP" matches,
// "APPLE INC" vs "APPLE HOSPITALITY REIT INC" does not).
function sameIssuer(a, b) {
  const ta = norm(a).split(' ');
  const tb = norm(b).split(' ');
  const [s, l] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (!s.length || !s.every((tok, i) => tok === l[i])) return false;
  return l.length - s.length <= 1;
}

// Find recent 13F-HR filings whose information table mentions the issuer via
// EDGAR full-text search, then pull the matching rows. Inherently a sample of
// holders, not a census — scanning every 13F is infeasible.
export async function institutionalHolders(issuerName) {
  const q = `"${issuerName.replace(/[".,]/g, ' ').replace(/\s+/g, ' ').trim()}"`;
  // Restrict to the last 120 days so we sample the latest quarterly filing
  // season instead of relevance-ranked hits from any year.
  const end = new Date();
  const start = new Date(end.getTime() - 120 * 86400000);
  const day = (d) => d.toISOString().slice(0, 10);
  const base =
    `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}` +
    `&forms=13F-HR&startdt=${day(start)}&enddt=${day(end)}`;

  const pages = await mapLimit([0, 10], 2, (from) =>
    cachedFetch(`${base}&from=${from}`, { ttl: 6 * 60 * 60_000 }),
  );

  const targets = pages
    .flatMap((p) => p?.hits?.hits ?? [])
    .filter((h) => h._id?.endsWith('.xml') && !h._id.includes('primary_doc'))
    .slice(0, 20);

  const holders = await mapLimit(targets, 4, async (h) => {
    const [adsh, file] = h._id.split(':');
    const cik = Number((h._source?.ciks ?? [])[0]);
    if (!cik || !file) return null;
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replaceAll('-', '')}/${file}`;
    const xml = await cachedFetch(url, { as: 'text', ttl: 12 * 60 * 60_000 });
    const rows = arr(parser.parse(xml)?.informationTable?.infoTable).filter((r) =>
      sameIssuer(r.nameOfIssuer, issuerName),
    );
    if (!rows.length) return null;
    return {
      filer: String(h._source?.display_names?.[0] ?? 'Unknown filer')
        .replace(/\s*\(CIK.*\)$/, '')
        .trim(),
      filedAt: h._source?.file_date ?? null,
      period: h._source?.period_ending ?? null,
      shares: rows.reduce((s, r) => s + (Number(r.shrsOrPrnAmt?.sshPrnamt) || 0), 0),
      value: rows.reduce((s, r) => s + (Number(r.value) || 0), 0),
      putCall: rows.find((r) => r.putCall)?.putCall ?? null,
      link: url,
    };
  });

  // Keep the most recent filing per filer, largest positions first.
  const byFiler = new Map();
  for (const h of holders.filter(Boolean)) {
    const prev = byFiler.get(h.filer);
    if (!prev || (h.filedAt ?? '') > (prev.filedAt ?? '')) byFiler.set(h.filer, h);
  }
  return [...byFiler.values()].sort((a, b) => b.value - a.value);
}
