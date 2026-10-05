/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "Enforce design system guidelines in apps (Part 2 / section 12)" },
    messages: {
      noLocalUi: "No local components/ui directory inside apps. All UI primitives must come from @bs/ui.",
      noRestrictedImports: "Direct import of '{{pkg}}' is forbidden in apps. Import primitives from @bs/ui.",
      noNativeSelect: "Do not use native <select>. Use Select, SimpleSelect or Combobox from @bs/ui.",
      noWindowConfirm: "Do not use window.confirm. Use ConfirmDialog from @bs/ui.",
      noRoundedFullButton: "Buttons must be rectangular with 6px radius (no rounded-full on Button).",
      noRawHex: "Raw hex colors ({{hex}}) are forbidden in app components. Use semantic CSS tokens (--brand, --border, etc.).",
    },
    schema: [],
  },
  create(context) {
    const file = context.filename.replaceAll("\\", "/");
    // Only apply in apps/*/src/
    if (!/\/apps\/[^/]+\/src\//.test(file)) return {};

    // Allowlist Appearance preview, theme tokens, theme editors, and color pickers where merchant sets brand hex
    const isAppearancePreview = /appearance|theme-tokens|boot-shell|online-store\/theme|settings\/branding/i.test(file);

    return {
      Program(node) {
        if (/\/apps\/[^/]+\/src\/components\/ui\//.test(file)) {
          context.report({ node, messageId: "noLocalUi" });
        }
      },
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string") return;

        // Check restricted raw packages in apps
        const banned = [
          "@radix-ui/",
          "@base-ui/react",
          "sonner",
          "react-day-picker",
          "cmdk",
          "vaul",
        ];
        for (const pkg of banned) {
          if (source === pkg || source.startsWith(pkg)) {
            context.report({ node, messageId: "noRestrictedImports", data: { pkg } });
          }
        }
      },
      JSXOpeningElement(node) {
        // Check native <select>
        if (node.name.type === "JSXIdentifier" && node.name.name === "select") {
          context.report({ node, messageId: "noNativeSelect" });
        }

        // Check rounded-full on Button
        if (node.name.type === "JSXIdentifier" && node.name.name === "Button") {
          for (const attr of node.attributes) {
            if (attr.type === "JSXAttribute" && attr.name.name === "className") {
              if (attr.value?.type === "Literal" && typeof attr.value.value === "string") {
                if (attr.value.value.includes("rounded-full")) {
                  context.report({ node, messageId: "noRoundedFullButton" });
                }
              }
            }
          }
        }
      },
      CallExpression(node) {
        // Check window.confirm or confirm(...)
        if (
          (node.callee.type === "MemberExpression" &&
            node.callee.object.type === "Identifier" &&
            node.callee.object.name === "window" &&
            node.callee.property.type === "Identifier" &&
            node.callee.property.name === "confirm") ||
          (node.callee.type === "Identifier" && node.callee.name === "confirm")
        ) {
          context.report({ node, messageId: "noWindowConfirm" });
        }
      },
      Literal(node) {
        if (isAppearancePreview) return;
        if (typeof node.value === "string") {
          // Check for hex colors like #00d4a4, #ffffff, #123456
          const hexMatch = node.value.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/);
          if (hexMatch) {
            // Avoid flagging harmless strings like anchors (e.g. #orders, #) or color definitions in dev kit
            if (!file.includes("Kit.tsx") && !file.includes(".test.") && !node.value.startsWith("#/") && !node.value.startsWith("#anchor")) {
              context.report({ node, messageId: "noRawHex", data: { hex: hexMatch[0] } });
            }
          }
        }
      },
    };
  },
};
