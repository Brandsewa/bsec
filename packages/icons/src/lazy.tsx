import { useEffect, useState, type ReactElement } from "react";
import type { IconNode } from "./generated/data.ts";
import { resolveIconName, strokeOf } from "./index.ts";
import { drawIcon, type IconSvgProps } from "./render.tsx";

// Browser build of ./server (package.json "browser" condition): the same props, but the icon table is fetched as its
// own chunk on first use, so admin and editor bundles stay small. Renders nothing until the chunk has arrived.
let table: Readonly<Record<string, IconNode>> | undefined;
let pending: Promise<void> | undefined;
const load = () => (pending ??= import("./generated/data.ts").then((m) => void (table = m.LUCIDE_DATA)));

export function IconSvg({ name, ...rest }: IconSvgProps): ReactElement | null {
  const [, setReady] = useState(table !== undefined);
  useEffect(() => {
    if (!table) void load().then(() => setReady(true));
  }, []);
  const resolved = resolveIconName(name);
  const node = resolved && table ? table[resolved] : undefined;
  return node ? drawIcon(node, { ...rest, strokeWidth: rest.strokeWidth ?? strokeOf(name) }) : null;
}
