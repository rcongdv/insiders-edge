// Derived options-flow signals from a single expiration's chain.
export function optionsFlow(chain) {
  if (!chain || (!chain.calls?.length && !chain.puts?.length)) return null;
  const { calls = [], puts = [], spot } = chain;
  const sum = (xs, f) => xs.reduce((acc, x) => acc + (f(x) ?? 0), 0);

  const callVol = sum(calls, (c) => c.volume);
  const putVol = sum(puts, (p) => p.volume);
  const callOI = sum(calls, (c) => c.oi);
  const putOI = sum(puts, (p) => p.oi);

  // Max pain: the strike that minimizes the total intrinsic value written
  // contracts would pay out if the stock pinned there at expiration.
  const strikes = [...new Set([...calls, ...puts].map((c) => c.strike))]
    .filter((s) => s != null)
    .sort((a, b) => a - b);
  let maxPain = null;
  let least = Infinity;
  for (const s of strikes) {
    const pain =
      sum(calls, (c) => Math.max(0, s - c.strike) * c.oi) +
      sum(puts, (p) => Math.max(0, p.strike - s) * p.oi);
    if (pain < least) {
      least = pain;
      maxPain = s;
    }
  }

  // ATM IV: average implied volatility of the contracts nearest the spot price.
  let atmIv = null;
  if (spot != null) {
    const nearest = (xs) =>
      xs
        .filter((c) => c.iv != null && c.iv > 0)
        .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
        .slice(0, 2);
    const sample = [...nearest(calls), ...nearest(puts)];
    if (sample.length) atmIv = sum(sample, (c) => c.iv) / sample.length;
  }

  // Unusual activity: today's volume dwarfing open interest means positions
  // being opened now, not carried — the closest thing to footprints in options.
  const unusual = [
    ...calls.map((c) => ({ ...c, type: 'C' })),
    ...puts.map((p) => ({ ...p, type: 'P' })),
  ]
    .filter((c) => c.volume >= 500)
    .map((c) => ({ ...c, ratio: c.volume / Math.max(c.oi, 1) }))
    .filter((c) => c.ratio >= 2)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5);

  return {
    callVol,
    putVol,
    pcVolume: callVol > 0 ? putVol / callVol : null,
    pcOI: callOI > 0 ? putOI / callOI : null,
    maxPain,
    atmIv,
    unusual,
  };
}
