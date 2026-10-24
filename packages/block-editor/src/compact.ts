/**
 * Compact density for the whole page builder (sidebars, block list, field panels). Puck sizes its
 * controls for a roomy editor; the builder shows a lot of fields at once, so everything is a step
 * smaller: 12px text, 11px labels, ~28px fields and pills.
 *
 * Puck exposes its field metrics as CSS variables, which are set here first (the supported way). The
 * rest are class-substring selectors (the class names are hashed) with a leading ancestor selector so
 * they win over Puck's own single-class rules without !important.
 */
export const COMPACT_CSS = `
[class*="PuckLayout"] {
  --puck-field-space-y: 5px;
  --puck-field-space-x: 8px;
  --puck-field-font-size: 12px;
  --puck-field-radius: 7px;
}

/* Fields: text, textarea, number, select */
[class*="PuckLayout"] [class*="Input-input"] { font-size: 12px; line-height: 1.35; padding: 5px 8px; border-radius: 7px; }
[class*="PuckLayout"] [class*="Input-select"] select[class*="Input-input"] { padding-right: 26px; }
[class*="PuckLayout"] [class*="Input-label"] { font-size: 11px; font-weight: 600; gap: 4px; padding-bottom: 4px; }
[class*="PuckLayout"] [class*="Input-labelIcon"] svg { width: 13px; height: 13px; }
[class*="PuckLayout"] [class*="Input-radio"] { font-size: 12px; }
[class*="PuckLayout"] [class*="Input-radioInner"] { font-size: 12px; padding: 5px 10px; }
[class*="PuckLayout"] [class*="InputWrapper"] { padding-block: 0; }

/* Field groups in the right panel: tighter rhythm */
[class*="PuckLayout"] [class*="PuckFields_"] { gap: 0; }
[class*="PuckLayout"] [class*="PuckFields-field"] { padding: 8px 4px 9px; }
[class*="PuckLayout"] [class*="SidebarSection-title"] { padding-block: 8px; }
[class*="PuckLayout"] [class*="SidebarSection-content"] { padding: 4px 10px 10px; }
[class*="PuckLayout"] [class*="SidebarSection-heading"] h2 { font-size: 13px; }
[class*="PuckLayout"] [class*="SidebarSection-breadcrumb"] { font-size: 12px; }

/* Block list (the pills) */
[class*="PuckLayout"] [class*="DrawerItem-draggable"] { padding: 6px 10px; border-radius: 7px; font-size: 12px; }
[class*="PuckLayout"] [class*="DrawerItem-name"] { font-size: 12px; line-height: 1.3; }
[class*="PuckLayout"] [class*="DrawerItem-draggable"] svg { width: 13px; height: 13px; }
[class*="PuckLayout"] [class*="Drawer_"] { gap: 4px; }
[class*="PuckLayout"] [class*="DrawerItem_"] { margin: 0; }

/* Category headings in the block list and outline */
[class*="PuckLayout"] [class*="Group-title"] { font-size: 11px; padding-block: 6px; }
[class*="PuckLayout"] [class*="Group-title"] svg { width: 13px; height: 13px; }

/* Accordion sections inside a block's fields (see sections.tsx): headers are slim rows, closed sections leave no gap. */
[class*="PuckLayout"] [class*="PuckFields-field"]:has([data-sec-closed]) { display: none; }
/* Inside an accordion the fields sit together without Puck's divider line between each one. */
[class*="PuckLayout"] [class*="PuckFields-field"]:has([data-sec-field]) { border: 0; border-top-width: 0; padding: 3px 4px 5px; }
@keyframes bricksAccordionFade {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
/* The header bar is the shaded element; Puck's row around it has no border or fill of its own. */
[class*="PuckLayout"] [class*="PuckFields-field"]:has([data-sec-header]) { padding: 3px 4px; border: 0; border-top-width: 0; background: none; }
[class*="PuckLayout"] [data-sec-header] { background: #f0f0f3; border-radius: 7px; }
[class*="PuckLayout"] [data-sec-header] button { padding-inline: 8px; }

/* The editor is always a light surface. Inside a dark app (Super Admin) the text colour would be inherited
   from the page and come out white on white (outline names, theme colour chips), so it is pinned here. */
[class*="PuckLayout"] { color: #18181b; color-scheme: light; }

/* Left rail (Theme, Blocks, Outline): smaller icons and labels */
[class*="PuckLayout"] [class*="NavItem-link"] { font-size: 10.5px; gap: 2px; padding-block: 8px; }
[class*="PuckLayout"] [class*="NavItem-link"] svg { width: 18px; height: 18px; }

/* -------------------------------------------------------------------------- */
/* Canvas Guidelines & Empty State Indicators (Bricks Builder Style)           */
/* -------------------------------------------------------------------------- */

/* Subtle dotted/dashed outlines on all layout elements so boundaries are visible */
.bsb.brxe-section {
  outline: 1px dashed rgba(59, 130, 246, 0.28);
  outline-offset: -1px;
}
.bsb.brxe-container {
  outline: 1px dashed rgba(16, 185, 129, 0.35);
  outline-offset: -1px;
}
.bsb.brxe-block {
  outline: 1px dashed rgba(245, 158, 11, 0.35);
  outline-offset: -1px;
}

/* Hovering or active guides */
.bsb.brxe-section:hover {
  outline-color: rgba(59, 130, 246, 0.6);
}
.bsb.brxe-container:hover {
  outline-color: rgba(16, 185, 129, 0.7);
}
.bsb.brxe-block:hover {
  outline-color: rgba(245, 158, 11, 0.7);
}

/* When a container or block has an empty dropzone, show clear Bricks-style placeholder guidelines */
[data-puck-dropzone]:empty,
[class*="_DropZone_"]:empty {
  min-height: 80px !important;
  width: 100% !important;
  flex: 1 1 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background: repeating-linear-gradient(
    -45deg,
    rgba(240, 240, 243, 0.6),
    rgba(240, 240, 243, 0.6) 10px,
    rgba(255, 255, 255, 0.8) 10px,
    rgba(255, 255, 255, 0.8) 20px
  ) !important;
  outline: 1.5px dashed #cbd5e1 !important;
  outline-offset: -2px !important;
  border-radius: 4px;
  position: relative;
}

/* Ensure dropzones and draggable items inside flex containers properly stretch/grow */
[data-puck-dropzone] {
  width: 100%;
  height: 100%;
}

/* Puck wraps each dropped block in a draggable wrapper div; ensure it respects flex distribution */
[data-puck-dropzone] > div:has(> .brxe-block),
[data-puck-dropzone] > [data-puck-component]:has(.brxe-block) {
  flex: 1 1 0;
  display: flex;
  min-width: 0;
}

[data-puck-dropzone] > div:has(> .brxe-container),
[data-puck-dropzone] > [data-puck-component]:has(.brxe-container) {
  width: 100%;
}

[data-puck-dropzone]:empty::after,
[class*="_DropZone_"]:empty::after {
  content: "Drop elements here";
  font-size: 11px;
  font-weight: 500;
  color: #94a3b8;
  letter-spacing: 0.02em;
  pointer-events: none;
}

/* Specific labels when empty inside Container or Block */
.brxe-container > [data-puck-dropzone]:empty::after,
.brxe-container > [class*="_DropZone_"]:empty::after {
  content: "Container (Drop Blocks or Elements)";
}

.brxe-block > [data-puck-dropzone]:empty::after,
.brxe-block > [class*="_DropZone_"]:empty::after {
  content: "Block (Drop Elements)";
}
`;
