/**
 * Every cache tag must start with the tenant: `t:${tenantId}:...` (PLAN §11.6).
 * Accepted arguments to cacheTag / revalidateTag / updateTag:
 *   - tenantTag(...) calls (the helper in @bs/domain)
 *   - template literals whose first chunk is exactly "t:" followed by an expression and ":"
 */
const TAG_FNS = new Set(["cacheTag", "revalidateTag", "updateTag"]);

function calleeName(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  return null;
}

function isTenantPrefixed(arg) {
  if (arg.type === "CallExpression") return calleeName(arg.callee) === "tenantTag";
  if (arg.type === "TemplateLiteral") {
    const [first, second] = arg.quasis;
    return (
      first?.value.cooked === "t:" &&
      arg.expressions.length > 0 &&
      typeof second?.value.cooked === "string" &&
      second.value.cooked.startsWith(":")
    );
  }
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "Require tenant-prefixed cache tags (t:{tenantId}:...)" },
    messages: {
      notTenant:
        "{{fn}}() tags must be tenant-prefixed: use tenantTag(ctx, ...) or a `t:${tenantId}:...` template.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const fn = calleeName(node.callee);
        if (!fn || !TAG_FNS.has(fn)) return;
        // revalidateTag(tag, profile) / updateTag(tag): only the first argument is a tag.
        const tagArgs = fn === "cacheTag" ? node.arguments : node.arguments.slice(0, 1);
        for (const arg of tagArgs) {
          if (!isTenantPrefixed(arg)) context.report({ node: arg, messageId: "notTenant", data: { fn } });
        }
      },
    };
  },
};
