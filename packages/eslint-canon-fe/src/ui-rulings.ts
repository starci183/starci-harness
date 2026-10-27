/** Owner UI rulings: selection uses fill, and applications respect Grammar styling ownership. */
import type { TSESTree } from "@typescript-eslint/utils";
import { attribute, attributeValue, staticText } from "./lib/ast.ts";
import { importOf } from "./lib/bindings.ts";
import { defineRule, type AnyContext, type Node, type Recommended, type Rules } from "./lib/rule.ts";
import { isProductSource } from "./lib/scope.ts";
import { typedClassStrings } from "./lib/typed-class-values.ts";

/** Resolve a named or namespace import at its use, preserving lexical shadowing. */
const grammarComponent = (context: AnyContext, opening: TSESTree.JSXOpeningElement, expected: string): boolean => {
  const name = opening.name;
  const root = name.type === "JSXMemberExpression" ? name.object : name;
  if (root.type !== "JSXIdentifier") return false;
  const binding = importOf(context, root);
  if (
    !binding ||
    !/^@starci\/grammar(?:\/(?:common|core|offset-pop))?$/.test(
      binding.source,
    )
  )
    return false;
  return name.type === "JSXMemberExpression"
    ? binding.imported === null && name.property.name === expected
    : binding.imported === expected;
};

/** Only a final explicit attribute is proof when an opaque spread could override a value. */
/** True when `text` is one of `values`; a missing text never is. */
const oneOf = (values: readonly string[], text: string | null): boolean => text !== null && values.includes(text);

/** The plain tag name of a JSX element (`nav`), or null for a member or namespaced name. */
const plainTag = (name: TSESTree.JSXTagNameExpression): string | null => (name.type === "JSXIdentifier" ? name.name : null);

const propText = (opening: TSESTree.JSXOpeningElement, key: string): string | null => {
  let value: string | null = null;
  for (const entry of opening.attributes) {
    if (entry.type === "JSXSpreadAttribute") value = null;
    else if (entry.name.name === key) value = staticText(entry.value);
  }
  return value;
};

/** Navigation and rail/list placement are structurally identifiable without guessing from product names. */
const navigationList = (context: AnyContext, opening: TSESTree.JSXOpeningElement): boolean => {
  for (let node: Node | undefined = opening.parent; node; node = node.parent) {
    if (node.type !== "JSXElement") continue;
    const parent = node.openingElement;
    if (
      oneOf(["nav", "ul", "ol"], plainTag(parent.name)) ||
      oneOf(["navigation", "list"], propText(parent, "role"))
    )
      return true;
    if (
      ["Rail", "Sidebar"].some((role) =>
        grammarComponent(context, parent, role),
      )
    )
      return true;
  }
  return false;
};

/** Navigation-like single selection uses the row fill instead of a second check indicator. */
export const selectionFillNoCheck = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Navigation-like single-select ListBox rows use selectionIndicator=none.",
    },
    schema: [],
    messages: {
      indicator:
        'Use selectionIndicator="none" on this navigation-like single-select ListBox; the row fill carries selection.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node: TSESTree.JSXOpeningElement) {
        if (
          !grammarComponent(context, node, "ListBox") ||
          !navigationList(context, node)
        )
          return;
        if (oneOf(["none", "multiple"], propText(node, "selectionMode")))
          return;
        if (propText(node, "selectionIndicator") !== "none")
          context.report({ node, messageId: "indicator" });
      },
    };
  },
});

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
        "Remove this starci-core- selector. Compose the Grammar public API; message actions belong in the ChatBubble floating toolbar.",
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
  "selection-fill-no-check": selectionFillNoCheck,
  "no-grammar-internal-selector": noGrammarInternalSelector,
} satisfies Rules;

/** Both owner rulings are universal errors in the frontend canon. */
export const recommended: Recommended = Object.fromEntries(
  Object.keys(rules).map((name): [string, "error"] => [`starci-fe/${name}`, "error"]),
);
