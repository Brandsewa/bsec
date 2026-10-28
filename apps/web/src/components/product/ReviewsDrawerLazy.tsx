"use client";

import { useEffect, useState } from "react";
import type { ComponentType } from "react";

type DrawerProps = { productId: string; ratingAvg: number; total: number; onClose: () => void };

/** Loads the all-reviews drawer (sorting, star filter, paging) only when it is opened, so its code is not in the product page's JavaScript. */
export function ReviewsDrawerLazy(props: DrawerProps) {
  const [Drawer, setDrawer] = useState<ComponentType<DrawerProps> | null>(null);
  useEffect(() => {
    void import("./ReviewsDrawer.tsx").then((m) => setDrawer(() => m.ReviewsDrawer));
  }, []);
  return Drawer ? <Drawer {...props} /> : null;
}
