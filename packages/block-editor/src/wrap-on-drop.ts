import type { BlockType, PuckData, PuckItem } from "@bs/blocks";

/**
 * Store widgets that, when newly dropped on the page itself, arrive inside a Section > Container so the theme's Layout
 * settings (site width, section and container defaults) govern their width and spacing, like any other element.
 * Left out on purpose: full-bleed designs (Hero slider, Image banner), the announcement bar, the
 * site header and footer, and the blocks that only exist on one kind of theme page (product, cart, collection, blog).
 */
export const WRAP_ON_DROP: ReadonlySet<BlockType> = new Set<BlockType>([
  "MultiCard",
  "ProductShowcase",
  "CollectionGrid",
  "CollectionShowcase",
  "BlogShowcase",
  "Reviews",
  "ReviewsMarquee",
  "FaqSection",
  "Gallery",
  "TrustStrip",
]);

/** Puck's key for the page's own block list (drops inside a Section, Container or Block are the person's explicit choice). */
export const ROOT_ZONE = "root:default-zone";

const defaultId = (type: string) => `${type}-${globalThis.crypto.randomUUID()}`;

/**
 * Returns `data` with the top-level item `itemId` wrapped in Section > Container, or null when there is nothing to do
 * (not at the top level, or not a wrap-on-drop widget). Pure: callers decide when a drop is new.
 */
export function wrapDroppedWidget(data: PuckData, itemId: string, makeId: (type: string) => string = defaultId): PuckData | null {
  const index = data.content.findIndex((item) => item.props.id === itemId);
  const item = data.content[index];
  if (!item || !WRAP_ON_DROP.has(item.type as BlockType)) return null;
  const container: PuckItem = { type: "Container", props: { id: makeId("Container"), content: [item] } };
  const section: PuckItem = { type: "Section", props: { id: makeId("Section"), content: [container] } };
  const content = data.content.slice();
  content[index] = section;
  return { ...data, content };
}
