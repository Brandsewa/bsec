import type { ReactNode } from "react";
import type { z } from "zod";

export type BlockType =
  | "Hero"
  | "Banner"
  | "ProductGrid"
  | "CollectionGrid"
  | "ProductCarousel"
  | "Testimonials"
  | "Reviews"
  | "RichText"
  | "FAQ"
  | "Gallery"
  | "Newsletter"
  | "UspStrip";

export interface BlockDefinition<TProps = unknown> {
  type: BlockType;
  version: number;
  schema: z.ZodType<TProps>;
  defaultProps: TProps;
  render: (data: { props: TProps }) => ReactNode;
  migrate?: (fromVersion: number, props: unknown) => TProps;
}

export interface BlockInstance {
  id: string;
  type: BlockType;
  version: number;
  props: Record<string, unknown>;
  hidden?: boolean | undefined;
}

export interface BlockDocument {
  version: 1;
  blocks: BlockInstance[];
}
