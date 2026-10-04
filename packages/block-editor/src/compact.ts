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
/* The header bar is the shaded element; Puck's row around it has no border or fill of its own. */
[class*="PuckLayout"] [class*="PuckFields-field"]:has([data-sec-header]) { padding: 3px 4px; border: 0; border-top-width: 0; background: none; }
[class*="PuckLayout"] [data-sec-header] { background: #f0f0f3; border-radius: 7px; }
[class*="PuckLayout"] [data-sec-header] button { padding-inline: 8px; }

/* Left rail labels (Theme, Blocks, Outline) */
[class*="PuckLayout"] [class*="SidebarRail"] { font-size: 11px; }
`;
