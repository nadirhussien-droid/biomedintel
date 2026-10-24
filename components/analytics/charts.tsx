// Charts for the analytics overview. Each is drawn as SVG and also written out in words and numbers,
// so nothing depends on colour or on seeing the picture.
import type { ChartSpec } from "@/server/export/document";

function Donut({ c }: { c: ChartSpec }) {
  const total = c.items.reduce((a, i) => a + i.value, 0);
  const R = 40;
  let a0 = -Math.PI / 2;
  const pt = (a: number) => `${50 + R * Math.cos(a)} ${50 + R * Math.sin(a)}`;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="size-28 shrink-0" role="img" aria-label={c.title}>
        {total <= 0 ? (
          <circle cx="50" cy="50" r={R} fill="#E3E9EF" />
        ) : (
          c.items
            .filter((i) => i.value > 0)
            .map((i) => {
              if (i.value === total) return <circle key={i.label} cx="50" cy="50" r={R} fill={i.color} />;
              const a1 = a0 + (i.value / total) * Math.PI * 2;
              const d = `M 50 50 L ${pt(a0)} A ${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)} Z`;
              a0 = a1;
              return <path key={i.label} d={d} fill={i.color} />;
            })
        )}
        <circle cx="50" cy="50" r={R * 0.62} fill="#fff" />
        {c.centre ? (
          <>
            <text x="50" y="52" textAnchor="middle" fontSize="15" fontWeight="700" fill="currentColor">
              {c.centre.value}
            </text>
            <text x="50" y="63" textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.7">
              {c.centre.label}
            </text>
          </>
        ) : null}
      </svg>
      <ul className="flex flex-col gap-2 text-sm">
        {c.items.map((i) => (
          <li key={i.label} className="flex items-start gap-2">
            <span className="mt-1 size-3 shrink-0 rounded-sm" style={{ background: i.color }} aria-hidden="true" />
            <span>
              <strong className="text-ink">
                {i.value}
                {total > 0 ? ` (${Math.round((i.value / total) * 100)}%)` : ""}
              </strong>{" "}
              <span className="text-ink-muted">{i.label}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bars({ c }: { c: ChartSpec }) {
  const max = Math.max(1, ...c.items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {c.items.map((i) => (
        <li key={i.label} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-ink-muted">{i.label}</span>
            <strong className="text-ink">{i.value}</strong>
          </div>
          <div className="mt-1 h-2.5 rounded-full bg-black/5" aria-hidden="true">
            <div
              className="h-2.5 rounded-full"
              style={{ width: `${i.value > 0 ? Math.max(2, (i.value / max) * 100) : 0}%`, background: i.color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ChartGrid({ charts }: { charts: ChartSpec[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {charts.map((c) => (
        <section key={c.title} className="border-line-strong rounded-lg border bg-white p-4">
          <h3 className="text-ink mb-3 text-sm font-semibold">{c.title}</h3>
          {c.kind === "donut" ? <Donut c={c} /> : <Bars c={c} />}
        </section>
      ))}
    </div>
  );
}
