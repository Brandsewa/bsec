import type { ReactNode } from "react";

/** One-weight line icons for the marketing home page: 24 grid, 1.5 stroke, `currentColor`, so both themes need nothing extra. */
function Line({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

export const SunIcon = (p: IconProps) => <Line {...p}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></Line>;
export const MoonIcon = (p: IconProps) => <Line {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></Line>;
export const MenuIcon = (p: IconProps) => <Line {...p}><path d="M4 8h16M4 16h16" /></Line>;
export const CloseIcon = (p: IconProps) => <Line {...p}><path d="M6 6l12 12M18 6 6 18" /></Line>;
export const CheckIcon = (p: IconProps) => <Line {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Line>;
export const ArrowIcon = (p: IconProps) => <Line {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Line>;
export const GridIcon = (p: IconProps) => <Line {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></Line>;
export const BoxIcon = (p: IconProps) => <Line {...p}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></Line>;
export const TagIcon = (p: IconProps) => <Line {...p}><path d="M4 4h8l8 8-8 8-8-8V4Z" /><circle cx="8.5" cy="8.5" r="1" /></Line>;
export const UsersIcon = (p: IconProps) => <Line {...p}><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.5a6 6 0 0 1 3 5.5" /></Line>;
export const BrushIcon = (p: IconProps) => <Line {...p}><path d="M4 7h16M4 12h10M4 17h6" /><path d="m14 20 6.5-6.5-2-2L12 18v2h2Z" /></Line>;
export const CashIcon = (p: IconProps) => <Line {...p}><rect x="3" y="6" width="18" height="12" rx="1.5" /><circle cx="12" cy="12" r="2.5" /><path d="M6.5 9.5v5M17.5 9.5v5" /></Line>;
export const ReceiptIcon = (p: IconProps) => <Line {...p}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9.5 8h5M9.5 12h5" /></Line>;
export const ReturnIcon = (p: IconProps) => <Line {...p}><path d="M9 7 4.5 11.5 9 16" /><path d="M5 11.5h10a4.5 4.5 0 0 1 0 9h-3" /></Line>;
export const ClockIcon = (p: IconProps) => <Line {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Line>;
export const ChartIcon = (p: IconProps) => <Line {...p}><path d="M4 20V5M4 20h16" /><path d="m8 15 3.5-4 3 2.5L20 7" /></Line>;
export const ChatIcon = (p: IconProps) => <Line {...p}><path d="M4 5h16v12H9l-5 4V5Z" /></Line>;
export const LockIcon = (p: IconProps) => <Line {...p}><rect x="5" y="11" width="14" height="9.5" rx="1.5" /><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></Line>;
export const CardIcon = (p: IconProps) => <Line {...p}><rect x="3" y="6" width="18" height="13" rx="1.5" /><path d="M3 10.5h18M7 15h3" /></Line>;
export const SparkIcon = (p: IconProps) => <Line {...p}><path d="M12 4v5M12 15v5M4 12h5M15 12h5" /><circle cx="12" cy="12" r="1.2" /></Line>;
export const TruckIcon = (p: IconProps) => <Line {...p}><path d="M3 6.5h11v10H3zM14 10h4l3 3.5v3h-7" /><circle cx="7.5" cy="18" r="1.7" /><circle cx="17" cy="18" r="1.7" /></Line>;
export const GlobeIcon = (p: IconProps) => <Line {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5Z" /></Line>;
export const MailIcon = (p: IconProps) => <Line {...p}><rect x="3" y="5.5" width="18" height="13" rx="1.5" /><path d="m4 7 8 6 8-6" /></Line>;
export const ChatDotsIcon = (p: IconProps) => <Line {...p}><path d="M4 5h16v12H9l-5 4V5Z" /><path d="M9 11h.01M12 11h.01M15 11h.01" /></Line>;
