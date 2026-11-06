// WCAG contrast for the Branding editor. Mirrors packages/domain/src/system/email-branding.ts (the server is authoritative).
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
const SHADE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
function mixRgb(a: number[], b: number[], t: number): string {
  return `#${a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
/** Ten-step ramp for the preview. Mirrors shadeRamp in packages/domain/src/platform/branding-tokens.ts (the server output is authoritative). */
export function shadeRamp(color: string): Array<{ step: number; hex: string }> {
  const n = Number.parseInt(color.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return SHADE_STEPS.map((step) => ({
    step,
    hex: step === 500 ? color : step < 500 ? mixRgb(rgb, [255, 255, 255], ((500 - step) / 500) * 0.92) : mixRgb(rgb, [0, 0, 0], ((step - 500) / 400) * 0.6),
  }));
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
