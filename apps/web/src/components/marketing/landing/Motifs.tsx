import type { ReactNode, SVGProps } from "react";

/**
 * Authored SVG for the Block-Print Bazaar world: the carved rosette block, the printed imprint,
 * the logo mark and one consistent set of line icons (1.75 stroke, round caps).
 */

type SvgProps = SVGProps<SVGSVGElement>;

/** Eight-petal booti rosette, the repeated block motif. Fill comes from currentColor. */
export function Rosette(props: SvgProps) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" {...props}>
      <g transform="translate(60 60)" fill="currentColor">
        {[0, 45, 90, 135].map((r) => (
          <ellipse key={r} rx="9" ry="36" transform={`rotate(${r})`} />
        ))}
        <circle r="13" fill="var(--rosette-eye, #141c55)" />
        <circle r="6.5" />
        {[0, 90, 180, 270].map((r) => (
          <circle key={r} cx="0" cy="-50" r="4.2" transform={`rotate(${r + 45})`} />
        ))}
      </g>
    </svg>
  );
}

/** The wooden block itself: carved face, rough edge, handle notch. Used for the press animation. */
export function CarvedBlock(props: SvgProps) {
  return (
    <svg viewBox="0 0 160 190" aria-hidden="true" {...props}>
      <rect x="22" y="0" width="116" height="52" rx="10" fill="#6b3a1c" />
      <rect x="22" y="0" width="116" height="52" rx="10" fill="none" stroke="#3d1f0c" strokeWidth="3" />
      <path d="M50 14v24M80 14v24M110 14v24" stroke="#3d1f0c" strokeWidth="3" strokeLinecap="round" />
      <rect x="6" y="48" width="148" height="136" rx="14" fill="#8a4a24" />
      <rect x="6" y="48" width="148" height="136" rx="14" fill="none" stroke="#3d1f0c" strokeWidth="3.5" />
      <g transform="translate(80 118)" fill="#d79a62">
        {[0, 45, 90, 135].map((r) => (
          <ellipse key={r} rx="8.5" ry="34" transform={`rotate(${r})`} />
        ))}
        <circle r="12" fill="#8a4a24" />
        <circle r="6" />
      </g>
    </svg>
  );
}

/** Logo mark: a madder block with the rosette cut into it. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="bcom.si">
      <rect x="1" y="1" width="46" height="46" rx="11" fill="#b8301f" />
      <rect x="1" y="1" width="46" height="46" rx="11" fill="none" stroke="#f1e9d6" strokeOpacity=".35" strokeWidth="1.5" />
      <g transform="translate(24 24)" fill="#f1e9d6">
        {[0, 45, 90, 135].map((r) => (
          <ellipse key={r} rx="3.4" ry="14" transform={`rotate(${r})`} />
        ))}
        <circle r="5.2" fill="#b8301f" />
        <circle r="2.6" />
      </g>
    </svg>
  );
}

/** A needle, drawn at the head of the scroll thread. */
export function Needle(props: SvgProps) {
  return (
    <svg viewBox="0 0 20 44" aria-hidden="true" {...props}>
      <path d="M10 1c3 0 4 2 4 5v32c0 3-1 5-4 5s-4-2-4-5V6c0-3 1-5 4-5Z" fill="#f2b22d" />
      <ellipse cx="10" cy="9" rx="1.6" ry="3.6" fill="#141c55" />
    </svg>
  );
}

function Icon({ children, ...props }: SvgProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconCash = (p: SvgProps) => (
  <Icon {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 9.5v.01M18 14.5v.01" />
  </Icon>
);
export const IconReceipt = (p: SvgProps) => (
  <Icon {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
    <path d="M9 8h6M9 12h6" />
  </Icon>
);
export const IconLayout = (p: SvgProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M9 9v11" />
  </Icon>
);
export const IconBox = (p: SvgProps) => (
  <Icon {...p}>
    <path d="m3.5 7.5 8.5-4 8.5 4v9l-8.5 4-8.5-4v-9Z" />
    <path d="m3.5 7.5 8.5 4 8.5-4M12 11.5v9" />
  </Icon>
);
export const IconUsers = (p: SvgProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.8 20c.6-3.4 3-5.2 6.2-5.2s5.6 1.8 6.2 5.2" />
    <path d="M16.5 5.2a3.2 3.2 0 0 1 0 5.6M18 14.9c1.9.6 3.1 2.2 3.4 4.8" />
  </Icon>
);
export const IconTruck = (p: SvgProps) => (
  <Icon {...p}>
    <path d="M2.5 6.5h11v10h-11zM13.5 10h4l3 3v3.5h-7" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </Icon>
);
export const IconCheck = (p: SvgProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
export const IconArrow = (p: SvgProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const IconPlus = (p: SvgProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const IconClock = (p: SvgProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
