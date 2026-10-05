import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Validated Policy Block Types (PLAN Slice 7B / ADR-010).
 * Only: heading, paragraph, list, divider.
 * Plain text with inline bold/italic/link marks.
 * Links must be https: or mailto:/tel: (reject javascript:, data:).
 * Limits: <= 80 blocks, <= 30,000 chars total, <= 2,000 per paragraph.
 */

export const PolicyMarkSchema = z.object({
  type: z.enum(["bold", "italic", "link"]),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  href: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.end <= val.start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Mark end must be greater than start",
    });
  }
  if (val.type === "link") {
    if (!val.href) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Link mark must have an href",
      });
      return;
    }
    const href = val.href.trim().toLowerCase();
    const isAllowedScheme =
      href.startsWith("https://") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:");
    if (!isAllowedScheme) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Link href must use https:, mailto:, or tel: protocol",
      });
    }
  }
});
export type PolicyMark = z.infer<typeof PolicyMarkSchema>;

export const PolicyHeadingBlockSchema = z.object({
  type: z.literal("heading"),
  level: z.enum(["2", "3"]).or(z.literal(2)).or(z.literal(3)).transform((v) => Number(v) as 2 | 3),
  text: z.string().min(1).max(300),
});

export const PolicyParagraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  text: z.string().min(1).max(2000),
  marks: z.array(PolicyMarkSchema).optional(),
}).superRefine((val, ctx) => {
  if (val.marks) {
    for (const mark of val.marks) {
      if (mark.end > val.text.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Mark range exceeds paragraph text length",
        });
      }
    }
  }
});

export const PolicyListBlockSchema = z.object({
  type: z.literal("list"),
  style: z.enum(["ordered", "unordered"]).default("unordered"),
  items: z.array(z.string().min(1).max(500)).min(1).max(50),
});

export const PolicyDividerBlockSchema = z.object({
  type: z.literal("divider"),
});

export const PolicyBlockSchema = z.discriminatedUnion("type", [
  PolicyHeadingBlockSchema,
  PolicyParagraphBlockSchema,
  PolicyListBlockSchema,
  PolicyDividerBlockSchema,
]);
export type PolicyBlock = z.infer<typeof PolicyBlockSchema>;

export const PolicyContentSchema = z.object({
  v: z.literal(1),
  blocks: z.array(PolicyBlockSchema).min(1).max(80),
}).superRefine((val, ctx) => {
  let totalChars = 0;
  for (const block of val.blocks) {
    if (block.type === "heading") {
      totalChars += block.text.length;
    } else if (block.type === "paragraph") {
      totalChars += block.text.length;
    } else if (block.type === "list") {
      totalChars += block.items.reduce((sum, item) => sum + item.length, 0);
    }
  }

  if (totalChars > 30000) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Total policy content exceeds 30,000 characters limit (actual: ${totalChars})`,
    });
  }
});
export type PolicyContent = z.infer<typeof PolicyContentSchema>;

/**
 * Computes canonical SHA-256 hash of PolicyContent for immutable version tracking.
 */
export function computePolicyContentSha256(content: PolicyContent): string {
  // Canonical JSON stringification (sorted keys)
  const canonicalJson = JSON.stringify(content, Object.keys(content).sort());
  return createHash("sha256").update(canonicalJson).digest("hex");
}

/**
 * Pure policy content validator function.
 */
export function validatePolicyContent(input: unknown): { valid: true; data: PolicyContent; sha256: string } | { valid: false; error: string } {
  const result = PolicyContentSchema.safeParse(input);
  if (!result.success) {
    return { valid: false, error: result.error.issues[0]?.message ?? "Invalid policy content" };
  }
  const sha256 = computePolicyContentSha256(result.data);
  return { valid: true, data: result.data, sha256 };
}
