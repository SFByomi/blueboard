export function Spark({ values, w = 96, h = 28 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - ((v - min) / span) * (h - 4)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <path d={`${d}L${w},${h}L0,${h}Z`} fill="#22d3ee" opacity={0.12} />
      <path d={d} fill="none" stroke="#22d3ee" strokeWidth={1.5} />
    </svg>
  );
}
