/** UI rules: selection uses fill, and applications respect Grammar styling ownership. */
import type { TSESTree } from "@typescript-eslint/utils";
import { attribute, attributeValue } from "./lib/ast.ts";
import { defineRule, type Node, type Recommended, type Rules } from "./lib/rule.ts";
import { isProductSource } from "./lib/scope.ts";
import { typedClassStrings } from "./lib/typed-class-values.ts";

/** Grammar internal selectors belong to Grammar, including selectors in colocated class declarations. */
export const noGrammarInternalSelector = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Application styles cannot target starci-core internals.",
    },
    schema: [],
    messages: {
      internal:
        "Remove this starci-core- selector. Compose the Grammar public API; message actions belong in the MessageBubble floating toolbar.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {};
    const selector = /(?:\.|_|\[class[^\]]*)starci-core-/;
    const report = (node: Node, text: string | null): void => {
      if (text && selector.test(text))
        context.report({ node, messageId: "internal" });
    };
    return {
      Literal(node: TSESTree.Literal) {
        if (typeof node.value === "string") report(node, node.value);
      },
      TemplateElement(node: TSESTree.TemplateElement) {
        report(node, node.value.cooked);
      },
      JSXAttribute(node: TSESTree.JSXAttribute) {
        if (node.name.name !== "className") return;
        const value = attributeValue(attribute(node.parent, "className"));
        if (value?.type !== "Identifier" && value?.type !== "MemberExpression")
          return;
        const strings = typedClassStrings(context, value, "classes");
        if (strings.some((entry) => selector.test(entry.text)))
          context.report({ node, messageId: "internal" });
      },
    };
  },
});

export const rules = {
  "no-grammar-internal-selector": noGrammarInternalSelector,
} satisfies Rules;

/** Both rules are universal errors in the frontend canon. */
export const recommended: Recommended = Object.fromEntries(
  Object.keys(rules).map((name): [string, "error"] => [`starci-fe/${name}`, "error"]),
);
