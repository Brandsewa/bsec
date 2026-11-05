# Website builder: full-width containers, padding toggle on widgets, feature card side padding

- **Date:** 2026-11-05
- **Agent:** claude
- **Branch:** `feat/website-widget-padding`
- **Area:** blocks, block-editor
- **Type:** fix
- **Supersedes:** none

## Summary
A Section or Container on a website page now follows the theme's page width (it stayed at the 1200px default before), widgets put inside one add no padding of their own, every website widget has a "Keep default top and bottom padding" switch, and the Feature grid cards on phones get a side padding setting.

## What changed
- Page width: `websiteThemeCss` hands `--bs-site-w-d/t/m` and the Section / Container spacing variables (`--bs-sec-*`, `--bs-cnt-*`) to the website, so a Container is as wide as the width set in Theme > Layout (for example 1380px) and the Layout spacing now applies to website pages too. Before only the website's own `.wrap` followed the width.
- A store widget inside a Section or Container no longer adds its own top and bottom padding on website pages (`.mk :is(.brxe-section,.brxe-container) .bsb[class*="bsb-py-"]`); the layout element's padding settings decide. The earlier rule that removes the widget's side padding and max width inside a layout stays.
- New switch "Keep default top and bottom padding" (`defaultPadding`, on by default, so saved pages do not change) on Hero, Included strip, Statement, Feature grid, Steps, Dark band, Final call, Pricing table and Page header. Off removes the section's own padding so a Section or Container around it controls the space on every device.
- Feature grid: new "Phones: space inside each card, left and right" (`cardSidePadding`, default 16px). The folded cards had no side padding, so the title and text touched the card edge.

## Verification
Unit tests (blocks), typecheck of blocks and block-editor. NOT verified in a browser or on a phone: the full-width container at a 1380px page width, the switch on each widget, and the card padding.
