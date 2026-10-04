/** Deterministic starfield (same on server and client). A handful of stars twinkle; the rest stay still. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261005);
const STARS = Array.from({ length: 150 }, (_, i) => ({
  x: rand() * 100,
  y: rand() * 100,
  r: 0.5 + rand() * 1.1,
  o: 0.35 + rand() * 0.6,
  tw: i % 6 === 0,
  t: 3 + rand() * 4,
  dl: rand() * 5,
}));

export function Starfield() {
  return (
    <svg className="sk-stars" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {STARS.map((s, i) => (
        <circle
          key={i}
          cx={`${s.x.toFixed(2)}%`}
          cy={`${s.y.toFixed(2)}%`}
          r={s.r.toFixed(2)}
          fill={i % 11 === 0 ? "#ffc766" : "#dfe6ff"}
          opacity={s.o.toFixed(2)}
          className={s.tw ? "sk-tw" : undefined}
          style={s.tw ? ({ ["--o" as string]: s.o.toFixed(2), ["--t" as string]: `${s.t.toFixed(1)}s`, ["--dl" as string]: `${s.dl.toFixed(1)}s` } as React.CSSProperties) : undefined}
        />
      ))}
    </svg>
  );
}
