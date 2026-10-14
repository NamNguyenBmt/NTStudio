import { useRef, useState, useLayoutEffect, useMemo } from "react";
import { cn } from "../lib/cn";

const PAD = { top: 12, right: 76, bottom: 24, left: 44 };
const GRID_LINES = 4;

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export function LineChart({ xLabels, series, height = 220, formatValue, formatX = (x2) => x2, showTable, className }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = xLabels.length;
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const yMax = useMemo(() => niceMax(Math.max(0, ...series.flatMap((s) => s.values))), [series]);
  const x = (i) => PAD.left + (n <= 1 ? innerW / 2 : i / (n - 1) * innerW);
  const y = (v) => PAD.top + innerH - v / yMax * innerH;
  const endLabels = useMemo(() => {
    const items = series.map((s) => ({ key: s.key, label: s.label, colorClass: s.colorClass, y: y(s.values[n - 1] ?? 0) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) {
      if (items[i].y - items[i - 1].y < 14) items[i].y = items[i - 1].y + 14;
    }
    return items;
  }, [series, n, yMax, innerH]);
  const xTickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 90))));
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1)))));
  };
  if (showTable) {
    return <div className={cn("scroll-thin overflow-auto", className)} style={{ maxHeight: height }}>
      <table className="w-full text-left text-body-sm tabular">
        <thead className="sticky top-0 bg-surface-container-low text-label-sm uppercase tracking-wider text-outline">
          <tr>
            <th className="px-space-sm py-1.5 font-medium">Ngày</th>
            {series.map((s) => <th key={s.key} className="px-space-sm py-1.5 text-right font-medium">{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {xLabels.map((lbl, i) => <tr key={lbl} className="border-t border-overlay/[0.04] text-on-surface-variant">
            <td className="px-space-sm py-1 font-mono text-code">{formatX(lbl)}</td>
            {series.map((s) => <td key={s.key} className="px-space-sm py-1 text-right font-mono text-code text-on-surface">
              {formatValue(s.values[i] ?? 0)}
            </td>)}
          </tr>)}
        </tbody>
      </table>
    </div>;
  }
  const tooltipLeft = hover != null ? x(hover) : 0;
  const tooltipOnLeft = tooltipLeft > width * 0.6;
  return <div ref={wrapRef} className={cn("relative w-full", className)} style={{ height }}>
    <svg width={width} height={height} role="img" aria-label={`Biểu đồ: ${series.map((s) => s.label).join(", ")}`}>
      {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
        const v = yMax / GRID_LINES * i;
        const gy = y(v);
        return <g key={i}>
          <line x1={PAD.left} x2={PAD.left + innerW} y1={gy} y2={gy} className="stroke-overlay/[0.06]" strokeWidth={1} />
          <text x={PAD.left - 8} y={gy} dy="0.32em" textAnchor="end" className="fill-outline font-mono text-[10px]">
            {formatValue(v)}
          </text>
        </g>;
      })}
      {xLabels.map(
        (lbl, i) => i % xTickEvery === 0 || i === n - 1 ? <text
          key={lbl}
          x={x(i)}
          y={height - 6}
          textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
          className="fill-outline font-mono text-[10px]"
        >
          {formatX(lbl)}
        </text> : null
      )}
      {series.map((s) => <polyline
        key={s.key}
        points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={s.colorClass}
      />)}
      {endLabels.map((l) => <g key={l.key}>
        <circle cx={PAD.left + innerW + 8} cy={l.y} r={3} fill="currentColor" className={l.colorClass} />
        <text x={PAD.left + innerW + 14} y={l.y} dy="0.32em" className="fill-on-surface-variant text-[11px]">
          {l.label}
        </text>
      </g>)}
      {hover != null && <g pointerEvents="none">
        <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-outline/50" strokeWidth={1} />
        {series.map((s) => <circle
          key={s.key}
          cx={x(hover)}
          cy={y(s.values[hover] ?? 0)}
          r={4.5}
          fill="currentColor"
          strokeWidth={2}
          className={cn(s.colorClass, "stroke-surface-container-low")}
        />)}
      </g>}
      <rect
        x={PAD.left}
        y={PAD.top}
        width={innerW}
        height={innerH}
        fill="transparent"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />
    </svg>
    {hover != null && <div
      role="tooltip"
      className="pointer-events-none absolute top-2 z-10 min-w-[160px] rounded-xl bg-surface-container-high p-space-sm shadow-flyout"
      style={tooltipOnLeft ? { right: width - tooltipLeft + 12 } : { left: tooltipLeft + 12 }}
    >
      <div className="mb-1 font-mono text-code text-outline">{formatX(xLabels[hover])}</div>
      {series.map((s) => <div key={s.key} className="flex items-center gap-space-sm text-body-sm">
        <span className={cn("h-2 w-2 rounded-full bg-current", s.colorClass)} />
        <span className="flex-1 text-on-surface-variant">{s.label}</span>
        <span className="font-mono text-code tabular text-on-surface">{formatValue(s.values[hover] ?? 0)}</span>
      </div>)}
    </div>}
  </div>;
}
