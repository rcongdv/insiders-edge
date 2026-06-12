import { useEffect, useRef } from 'react';
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts';

// Snap a filing date to the first trading day on/after it so markers always
// land on a real bar.
function snap(dates, date) {
  let lo = 0;
  let hi = dates.length - 1;
  if (!dates.length || dates[hi] < date) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < date) lo = mid + 1;
    else hi = mid;
  }
  return dates[lo];
}

export default function PriceChart({ prices, loading, error, insiders, anomalies }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !prices?.length) return;

    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();

    const chart = createChart(ref.current, {
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: v('--ink-dim'),
        fontFamily: "'Spline Sans Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(125, 147, 127, 0.07)' },
        horzLines: { color: 'rgba(125, 147, 127, 0.07)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(125, 147, 127, 0.2)' },
      timeScale: { borderColor: 'rgba(125, 147, 127, 0.2)' },
    });

    const candles = chart.addCandlestickSeries({
      upColor: v('--green'),
      downColor: v('--red'),
      wickUpColor: v('--green'),
      wickDownColor: v('--red'),
      borderVisible: false,
    });
    candles.setData(
      prices.map((p) => ({ time: p.date, open: p.open, high: p.high, low: p.low, close: p.close })),
    );

    const anomalySet = new Set((anomalies ?? []).map((a) => a.date));
    const volume = chart.addHistogramSeries({
      priceScaleId: '',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(
      prices.map((p) => ({
        time: p.date,
        value: p.volume,
        color: anomalySet.has(p.date) ? v('--amber') : 'rgba(125, 147, 127, 0.25)',
      })),
    );

    const dates = prices.map((p) => p.date);
    const markers = (insiders ?? [])
      .filter((t) => (t.code === 'P' || t.code === 'S') && t.value > 0)
      .slice(0, 100)
      .map((t) => {
        const time = snap(dates, t.date);
        if (!time) return null;
        const buy = t.code === 'P';
        return {
          time,
          position: buy ? 'belowBar' : 'aboveBar',
          shape: buy ? 'arrowUp' : 'arrowDown',
          color: buy ? v('--green') : v('--red'),
          text: buy ? 'P' : 'S',
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    candles.setMarkers(markers);

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [prices, insiders, anomalies]);

  return (
    <section className="panel chart-panel" style={{ '--d': '90ms' }}>
      <div className="panel-head">
        <h3>Price &amp; volume · 2y daily</h3>
        <div className="legend">
          <span className="legend-item"><i className="dot dot-green" /> insider buy</span>
          <span className="legend-item"><i className="dot dot-red" /> insider sale</span>
          <span className="legend-item"><i className="dot dot-amber" /> volume anomaly</span>
        </div>
      </div>
      {error ? (
        <div className="panel-error">{error}</div>
      ) : loading ? (
        <div className="skeleton" style={{ height: 420 }} />
      ) : (
        <div className="chart-host" ref={ref} />
      )}
    </section>
  );
}
