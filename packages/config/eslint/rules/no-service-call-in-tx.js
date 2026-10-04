/**
 * Prevent service calls passing `rt` or cache invalidation calls inside transaction callbacks
 * (e.g. withTenant, withUser, db.transaction).
 * A domain service called inside a transaction opens its own connection/transaction and cannot
 * see uncommitted rows. Invalidation calls must run post-commit.
 */

function isTxCall(node) {
  if (!node || node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (callee.type === "Identifier" && (callee.name === "withTenant" || callee.name === "withUser")) {
    return true;
  }
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
    if (callee.property.name === "transaction") return true;
  }
  return false;
}

const INVALIDATE_FNS = new Set([
  "invalidateCache",
  "revalidateTags",
  "invalidateTenantTags",
  "revalidateTag",
  "updateTag",
]);

function isInvalidationCall(node) {
  if (!node || node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (callee.type === "Identifier" && INVALIDATE_FNS.has(callee.name)) return true;
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
    if (INVALIDATE_FNS.has(callee.property.name)) return true;
  }
  return false;
}

/** A service that is handed the open transaction (`tx`) joins it instead of opening its own, so that is safe. */
function passesTx(node) {
  return node.arguments.some((arg) => arg.type === "Identifier" && arg.name === "tx");
}

function passesRt(node) {
  for (const arg of node.arguments) {
    if (arg.type === "Identifier" && arg.name === "rt") return true;
    if (
      (arg.type === "TSAsExpression" || arg.type === "TSTypeAssertion") &&
      arg.expression.type === "Identifier" &&
      arg.expression.name === "rt"
    ) {
      return true;
    }
  }
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow calling domain services with `rt` or invalidating cache inside transactions",
    },
    messages: {
      noTxServiceCall:
        "Commit first, then read or invalidate; a service called inside a transaction opens its own.",
    },
    schema: [],
  },
  create(context) {
    let txDepth = 0;

    function enterFunction(node) {
      if (node.parent && isTxCall(node.parent) && node.parent.arguments.includes(node)) {
        txDepth++;
      }
    }

    function exitFunction(node) {
      if (node.parent && isTxCall(node.parent) && node.parent.arguments.includes(node)) {
        txDepth--;
      }
    }

    return {
      FunctionDeclaration: enterFunction,
      FunctionExpression: enterFunction,
      ArrowFunctionExpression: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      "FunctionExpression:exit": exitFunction,
      "ArrowFunctionExpression:exit": exitFunction,

      CallExpression(node) {
        if (txDepth <= 0) return;
        if (isInvalidationCall(node) || (passesRt(node) && !passesTx(node))) {
          context.report({ node, messageId: "noTxServiceCall" });
        }
      },
    };
  },
};
