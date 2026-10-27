/**
 * The rules that hold `env-owner.md` (HFS R49, `FE_ENV_OWNER`).
 *
 * TWO FACTS, ONE OWNER. The environment is read in exactly one place, `modules/config`, and what it
 * reads has no default that stands in for a real deployment value. They are one law because they
 * fail together: an app with nine copies of `process.env.API_URL ?? "http://localhost:3068"` had
 * nine readers and nine silent defaults, so a production build with the variable missing talked to
 * a developer's laptop and looked healthy.
 *
 * The rules cannot see whether `modules/config` throws when a variable is missing in production -
 * that is a behaviour, and the module's own spec is where it is proven. What they hold is the
 * shape that makes it provable: one reader, and no literal fallback next to it.
 */

import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import type { Variable } from "./lib/bindings.ts"
import { defineRule, type Node, type Recommended, type Rules, type SourceCode } from "./lib/rule.ts"
import { isConfigModule } from "./lib/scope.ts"

/** What a node holds on the way to the environment: the global object, `process`, `import.meta`, or the env object itself. */
type EnvKind = "global" | "process" | "meta" | "env" | null

/** `process.env`, or `import.meta.env`. */
const isEnvObject = (node: Node | null | undefined): boolean => {
  if (!node || node.type !== "MemberExpression" || node.computed) return false
  const name = node.property && node.property.name
  if (name !== "env") return false
  const object = node.object
  if (object.type === "Identifier" && object.name === "process") return true
  return (
    object.type === "MetaProperty" && object.meta.name === "import" && object.property.name === "meta"
  )
}

/** The variable name of `process.env.NAME` / `process.env["NAME"]`, or null. */
const envVariableName = (node: Node | null | undefined): string | null => {
  if (!node || node.type !== "MemberExpression" || !isEnvObject(node.object)) return null
  if (!node.computed && node.property.type === "Identifier") return node.property.name
  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") {
    return node.property.value
  }
  return null
}

/** Static text of a literal or an expression-free template, else null. */
const staticText = (node: Node | null | undefined): string | null => {
  if (!node) return null
  if (node.type === "Literal" && typeof node.value === "string") return node.value
  if (node.type === "TemplateLiteral") {
    return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("")
  }
  return null
}

/** An absolute or protocol-relative URL: what a fallback must never carry. */
const URL_TEXT = /^(?:https?:)?\/\/\S+/i

/** Variable names whose value is a secret or an address: a default for one is a hole in a deployment. */
const SENSITIVE_NAME = /(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|URL|URI|HOST|ENDPOINT|ORIGIN)$/i

/** Type assertions and optional chains preserve the identity of the wrapped value. */
const unwrapped = (node: Node | null | undefined): Node | null | undefined => {
  while (node && (node.type === "TSAsExpression" || node.type === "TSTypeAssertion" || node.type === "TSNonNullExpression" || node.type === "TSSatisfiesExpression" || node.type === "ChainExpression")) node = node.expression
  return node
}

/** The binding of this identifier, rather than every variable with the same spelling. */
const bindingOf = (sourceCode: SourceCode, identifier: TSESTree.Identifier): Variable | null => {
  for (let scope: TSESLint.Scope.Scope | null = sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name)
    if (variable) return variable
  }
  return null
}

/** Prior writes in the use's execution scope or its parents; a closure can capture a later initializer. */
const writeBefore = (sourceCode: SourceCode, variable: Variable, node: Node): TSESLint.Scope.Reference | undefined => {
  const scopes = new Set<TSESLint.Scope.Scope>()
  for (let scope: TSESLint.Scope.Scope | null = sourceCode.getScope(node); scope; scope = scope.upper) scopes.add(scope.variableScope)
  const writes = variable.references.filter((reference) => reference.isWrite()
    && scopes.has(reference.from.variableScope)
    && !(reference.writeExpr && reference.writeExpr.range[0] <= node.range[0] && node.range[1] <= reference.writeExpr.range[1]))
  return writes
    .filter((reference) => reference.identifier.range[0] < node.range[0])
    .sort((left, right) => right.identifier.range[0] - left.identifier.range[0])[0]
    ?? writes.find((reference) => reference.init)
}

/** Property extraction between a write's source and its destructured binding. */
const propertyPath = (identifier: Node): TSESTree.Property[] => {
  const properties: TSESTree.Property[] = []
  for (let node: Node = identifier; node.parent; node = node.parent) {
    const parent = node.parent
    if (parent.type === "Property" && parent.value === node) properties.unshift(parent)
    else if (parent.type !== "ObjectPattern" && !(parent.type === "AssignmentPattern" && parent.left === node)) break
  }
  return properties
}

/** The first quasi of a template literal: the parser always gives one. */
const firstQuasi = (node: TSESTree.TemplateLiteral): TSESTree.TemplateElement => {
  const quasi = node.quasis[0]
  if (quasi === undefined) throw new TypeError("a template literal without a quasi")
  return quasi
}

/** The module an import binding comes from; an import-equals declaration has no `source`, which stops the run as it always has. */
const importSource = (parent: TSESTree.ImportDeclaration | TSESTree.TSImportEqualsDeclaration): unknown => {
  if (parent.type !== "ImportDeclaration") throw new TypeError("Cannot read properties of undefined (reading 'value')")
  return parent.source.value
}

/** True for the specifier of Node's process module. */
const isProcessModule = (source: unknown): boolean => source === "process" || source === "node:process"

/** The import kind of the declaration that holds an import binding. */
const importKindOf = (parent: TSESTree.ImportDeclaration | TSESTree.TSImportEqualsDeclaration): string => parent.importKind

/** Known environment containers and constant computed keys, followed through local aliases. */
const environmentIdentity = (sourceCode: SourceCode) => {
  const textOf = (start: Node | null | undefined, seen = new Set<Node>()): string | null => {
    let node = start
    node = unwrapped(node)
    if (!node || seen.has(node)) return null
    if (node.type === "Literal" && typeof node.value === "string") return node.value
    if (node.type === "TemplateLiteral" && node.expressions.length === 0) return firstQuasi(node).value.cooked
    if (node.type !== "Identifier") return null
    const variable = bindingOf(sourceCode, node)
    if (!variable) return null
    const write = writeBefore(sourceCode, variable, node)
    if (!write?.writeExpr || propertyPath(write.identifier).length > 0) return null
    return textOf(write.writeExpr, new Set([...seen, node]))
  }
  const keyOf = (node: TSESTree.Property | TSESTree.MemberExpression): unknown => {
    const key = node.type === "Property" ? node.key : node.property
    if (node.computed) return textOf(key)
    if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name
    return key.type === "Literal" ? key.value : undefined
  }
  const propertyKind = (kind: EnvKind, key: unknown): EnvKind => {
    if (kind === "global" && key === "process") return "process"
    if ((kind === "process" || kind === "meta") && key === "env") return "env"
    return null
  }
  const kindOf = (start: Node | null | undefined, seen = new Set<Node>()): EnvKind => {
    const node = unwrapped(start)
    if (!node || seen.has(node)) return null
    if (node.type === "MetaProperty" && node.meta.name === "import" && node.property.name === "meta") return "meta"
    if (node.type === "MemberExpression") return propertyKind(kindOf(node.object, new Set([...seen, node])), keyOf(node))
    if (node.type !== "Identifier") return null
    const variable = bindingOf(sourceCode, node)
    if (!variable || variable.defs.length === 0) {
      if (node.name === "process") return "process"
      return ["globalThis", "global"].includes(node.name) ? "global" : null
    }
    const imported = variable.defs.find((definition) => definition.type === "ImportBinding" && isProcessModule(importSource(definition.parent)))
    if (imported && imported.type === "ImportBinding") {
      if (importKindOf(imported.parent) === "type" || (imported.node.type === "ImportSpecifier" && imported.node.importKind === "type")) return null
      if (imported.node.type !== "ImportSpecifier") return "process"
      const name = imported.node.imported.type === "Identifier" ? imported.node.imported.name : imported.node.imported.value
      return name === "default" ? "process" : name === "env" ? "env" : null
    }
    const write = writeBefore(sourceCode, variable, node)
    if (!write?.writeExpr) return null
    let kind = kindOf(write.writeExpr, new Set([...seen, node]))
    for (const property of propertyPath(write.identifier)) kind = propertyKind(kind, keyOf(property))
    return kind
  }
  const readsEnv = (pattern: Node, kind: EnvKind): boolean => {
    if (pattern.type === "AssignmentPattern") return readsEnv(pattern.left, kind)
    if (pattern.type !== "ObjectPattern") return false
    return pattern.properties.some((property) => {
      if (property.type !== "Property") return false
      const valueKind = propertyKind(kind, keyOf(property))
      return valueKind === "env" || readsEnv(property.value, valueKind)
    })
  }
  return { kindOf, readsEnv }
}

// -- FE-ENV-1 --------------------------------------------------------------------------------------

/** Only `modules/config` reads the environment. */
export const noEnvOutsideConfig = defineRule({
  meta: {
    type: "problem",
    docs: { description: "`process.env` and `import.meta.env` are read only in `modules/config`." },
    schema: [],
    messages: {
      env:
        "This file reads the environment. Only `modules/config` may: it is the one place that can fail loudly when a production variable is missing. Read the value from the config module's typed export instead.",
    },
  },
  create(context) {
    if (isConfigModule(context)) return {}
    const members: TSESTree.MemberExpression[] = []
    const destructures: { node: Node; pattern: TSESTree.ObjectPattern; value: Node }[] = []
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type" || !["process", "node:process"].includes(node.source.value)) return
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type" && (specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value) === "env") context.report({ node: specifier, messageId: "env" })
        }
      },
      MemberExpression(node) {
        members.push(node)
      },
      VariableDeclarator(node) {
        if (node.id.type === "ObjectPattern" && node.init) destructures.push({ node, pattern: node.id, value: node.init })
      },
      AssignmentExpression(node) {
        if (node.operator === "=" && node.left.type === "ObjectPattern") destructures.push({ node, pattern: node.left, value: node.right })
      },
      AssignmentPattern(node) {
        if (node.left.type === "ObjectPattern") destructures.push({ node, pattern: node.left, value: node.right })
      },
      "Program:exit"() {
        const { kindOf, readsEnv } = environmentIdentity(context.sourceCode ?? context.getSourceCode())
        for (const node of members) {
          if (kindOf(node) === "env") context.report({ node, messageId: "env" })
        }
        for (const { node, pattern, value } of destructures) {
          if (readsEnv(pattern, kindOf(value))) context.report({ node, messageId: "env" })
        }
      },
    }
  },
})

// -- FE-ENV-2 --------------------------------------------------------------------------------------

/** A fallback never stands in for a deployment address or secret. */
export const noHardcodedEndpointFallback = defineRule({
  meta: {
    type: "problem",
    docs: { description: "No URL literal as a fallback, and no literal default for an address or secret variable." },
    schema: [],
    messages: {
      url:
        "A URL literal used as a fallback (`?? \"http://...\"`, `|| \"http://...\"` or a parameter default). A missing variable then silently points production at a developer's machine. Read the address from `modules/config`, which throws when it is absent.",
      variable:
        "`{{name}}` is an address or secret variable with a literal default. A default here makes a misconfigured deployment look healthy. Remove the default and let `modules/config` fail loudly when it is missing.",
    },
  },
  create(context) {
    return {
      LogicalExpression(node) {
        if (node.operator !== "??" && node.operator !== "||") return
        const text = staticText(node.right)
        if (text === null) return
        if (URL_TEXT.test(text)) {
          context.report({ node: node.right, messageId: "url" })
          return
        }
        const name = envVariableName(node.left)
        if (name && text !== "" && SENSITIVE_NAME.test(name)) {
          context.report({ node: node.right, messageId: "variable", data: { name } })
        }
      },
      AssignmentPattern(node) {
        const text = staticText(node.right)
        if (text !== null && URL_TEXT.test(text)) context.report({ node: node.right, messageId: "url" })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Rules = {
  "no-env-outside-config": noEnvOutsideConfig,
  "no-hardcoded-endpoint-fallback": noHardcodedEndpointFallback,
}

/** Both are exact syntactic shapes, and both are errors. */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error"]))
