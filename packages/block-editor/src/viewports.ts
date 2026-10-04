import type { LayoutDevice } from "@bs/blocks";

/**
 * The editor's preview widths, listed largest first. They sit on the right side of the stylesheet's breakpoints
 * (phone values apply at 767px and below, tablet values at 1023px and below), so each preview shows what a real
 * device of that class shows. The layout panel reads the current preview width to know which device it edits.
 */
export const EDITOR_VIEWPORTS = [
  { device: "desktop", width: 1280, height: 900, label: "Desktop (1280px)", icon: "Monitor" },
  { device: "tablet", width: 768, height: 1024, label: "Tablet (768px)", icon: "Tablet" },
  { device: "mobile", width: 375, height: 812, label: "Mobile (375px)", icon: "Smartphone" },
] as const;

export function DEVICE_FOR_WIDTH(width: number): LayoutDevice {
  return width >= 1024 ? "desktop" : width >= 768 ? "tablet" : "mobile";
}
