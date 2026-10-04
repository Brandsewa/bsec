"use client";

/**
 * The store at the centre, what it does today in orbit. Pure SVG with slow CSS rotation; labels counter-rotate so
 * they stay upright. Everything shown is live in the product (see apps/web/PRODUCT.md).
 */
interface Planet { label: string; ring: number; angle: number; r: number; fill: string; speed: number }

const CX = 260;
const CY = 260;
const RINGS = [88, 150, 212];
const PLANETS: Planet[] = [
  { label: "Themes", ring: 0, angle: 35, r: 13, fill: "#8b7bff", speed: 48 },
  { label: "Cash on delivery", ring: 1, angle: 205, r: 15, fill: "#ffc766", speed: 72 },
  { label: "GST invoices", ring: 1, angle: 330, r: 11, fill: "#5eead4", speed: 72 },
  { label: "Orders", ring: 2, angle: 100, r: 14, fill: "#ff8fb1", speed: 104 },
  { label: "Customers", ring: 2, angle: 265, r: 12, fill: "#8bb6ff", speed: 104 },
];

export function OrbitHero() {
  const speeds = [48, 72, 104];
  return (
    <svg viewBox="0 0 520 520" className="sk-orbit-wrap w-full max-w-[34rem]" role="img" aria-label="Your store at the centre with themes, cash on delivery, GST invoices, orders and customers orbiting it">
      {/* faint star-chart ticks */}
      {Array.from({ length: 36 }, (_, i) => {
        const a = (i * 10 * Math.PI) / 180;
        const r1 = 236;
        const r2 = i % 3 === 0 ? 250 : 244;
        return <line key={i} x1={CX + r1 * Math.cos(a)} y1={CY + r1 * Math.sin(a)} x2={CX + r2 * Math.cos(a)} y2={CY + r2 * Math.sin(a)} stroke="rgb(190 200 255 / 0.3)" strokeWidth="1" />;
      })}
      {RINGS.map((radius, ringIdx) => (
        <g key={radius} className="sk-orbit" style={{ ["--sp" as string]: `${speeds[ringIdx]}s` } as React.CSSProperties}>
          <circle cx={CX} cy={CY} r={radius} fill="none" stroke="rgb(190 200 255 / 0.22)" strokeWidth="1" strokeDasharray={ringIdx === 1 ? "2 7" : undefined} />
          {PLANETS.filter((p) => p.ring === ringIdx).map((p) => {
            const a = (p.angle * Math.PI) / 180;
            const px = CX + radius * Math.cos(a);
            const py = CY + radius * Math.sin(a);
            return (
              <g key={p.label}>
                <circle cx={px} cy={py} r={p.r + 7} fill={p.fill} opacity="0.12" />
                <circle cx={px} cy={py} r={p.r} fill={p.fill} />
                <g className="sk-orbit-label" style={{ ["--sp" as string]: `${p.speed}s` } as React.CSSProperties}>
                  <text x={px} y={py - p.r - 12} textAnchor="middle" fontSize="14" fontWeight="600" fill="#eaedff" stroke="#060818" strokeWidth="5" paintOrder="stroke" style={{ fontFamily: "var(--sk-body)" }}>
                    {p.label}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
      ))}
      {/* the store */}
      <circle cx={CX} cy={CY} r="58" fill="#ffc766" opacity="0.1" />
      <circle cx={CX} cy={CY} r="46" fill="#ffc766" />
      <text x={CX} y={CY - 2} textAnchor="middle" fontSize="15" fontWeight="700" fill="#1a1230" style={{ fontFamily: "var(--sk-display)" }}>your store</text>
      <text x={CX} y={CY + 16} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="#1a1230" style={{ fontFamily: "var(--sk-body)" }}>.bcom.si</text>
    </svg>
  );
}
