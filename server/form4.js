import { XMLParser } from 'fast-xml-parser';
import { cachedFetch, mapLimit, padCik } from './edgar.js';

const parser = new XMLParser({ ignoreAttributes: true });

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
// Form 4 leaf values are wrapped in <value> elements, sometimes with footnote siblings.
const val = (x) => (x && typeof x === 'object' ? x.value : x);
const flag = (x) => {
  const v = val(x);
  return v === 1 || v === true || v === '1' || v === 'true';
};

export async function insiderTransactions(cik) {
  const sub = await cachedFetch(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`);
  const r = sub.filings?.recent ?? {};

  const filings = [];
  for (let i = 0; i < (r.form?.length ?? 0) && filings.length < 40; i++) {
    if (r.form[i] !== '4') continue;
    filings.push({
      accession: r.accessionNumber[i],
      filingDate: r.filingDate[i],
      primaryDoc: r.primaryDocument[i],
    });
  }

  const parsed = await mapLimit(filings, 5, async (f) => {
    const accNo = f.accession.replaceAll('-', '');
    // primaryDocument is often prefixed with an XSL viewer path; the raw XML
    // lives at the bare filename.
    const rawDoc = f.primaryDoc.split('/').pop();
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accNo}`;
    const xml = await cachedFetch(`${base}/${rawDoc}`, { as: 'text', ttl: 6 * 60 * 60_000 });
    return parseForm4(xml, { filingDate: f.filingDate, link: `${base}/${f.primaryDoc}` });
  });

  return parsed
    .flat()
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function parseForm4(xml, meta) {
  const doc = parser.parse(xml)?.ownershipDocument;
  if (!doc) return [];

  const owners = arr(doc.reportingOwner).map((o) => ({
    name: String(val(o.reportingOwnerId?.rptOwnerName) ?? 'Unknown'),
    isDirector: flag(o.reportingOwnerRelationship?.isDirector),
    isOfficer: flag(o.reportingOwnerRelationship?.isOfficer),
    isTenPercent: flag(o.reportingOwnerRelationship?.isTenPercentOwner),
    title: String(val(o.reportingOwnerRelationship?.officerTitle) ?? '').trim() || null,
  }));
  const who = owners[0] ?? { name: 'Unknown' };

  return arr(doc.nonDerivativeTable?.nonDerivativeTransaction).map((t) => {
    const shares = Number(val(t.transactionAmounts?.transactionShares)) || 0;
    const price = Number(val(t.transactionAmounts?.transactionPricePerShare)) || 0;
    return {
      owner: who.name,
      title: who.title ?? (who.isDirector ? 'Director' : who.isTenPercent ? '10% owner' : null),
      isDirector: !!who.isDirector,
      isOfficer: !!who.isOfficer,
      isTenPercent: !!who.isTenPercent,
      date: String(val(t.transactionDate) ?? meta.filingDate).slice(0, 10),
      filingDate: meta.filingDate,
      code: String(t.transactionCoding?.transactionCode ?? '?'),
      acquired: val(t.transactionAmounts?.transactionAcquiredDisposedCode) === 'A',
      shares,
      price,
      value: shares * price,
      sharesAfter:
        Number(val(t.postTransactionAmounts?.sharesOwnedFollowingTransaction)) || null,
      ownership: String(val(t.ownershipNature?.directOrIndirectOwnership) ?? 'D'),
      security: String(val(t.securityTitle) ?? 'Common Stock'),
      link: meta.link,
    };
  });
}
