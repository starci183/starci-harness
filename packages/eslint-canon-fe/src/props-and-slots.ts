/** Rules for named React props, ordinary children, and local visual ownership. */

import type { TSESTree } from "@typescript-eslint/utils"
import { defineRule, type Node, type Rules, type Recommended } from "./lib/rule.ts"
import { declarationsOf, fileOf as declarationFile } from "./lib/types.ts"
import { isComponentFile, isComponentPath, isProductSource, kindOfFile } from "./lib/scope.ts"

/** The key of a node that names a member (`key`), or the property of a member access. */
const memberKey = (node: Node | null | undefined): Node | undefined => {
  if (!node) return undefined
  if ("key" in node && node.key) return node.key
  return "property" in node ? node.property : undefined
}

const propertyName = (node: Node | null | undefined): string | null => {
  const key = memberKey(node)
  if (!key) return null
  if (key.type === "Identifier") return key.name
  if (key.type === "Literal" && typeof key.value === "string") return key.value
  return null
}

/** Reject anonymous object types on named component parameters. */
export const noInlineParameterType = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "A parameter uses a named props type, not an inline object shape." },
    schema: [],
    messages: { inline: "Name this parameter type in the module so the component API can be reused." },
  },
  create(context) {
    const check = (node: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | TSESTree.FunctionDeclaration): void => {
      for (const param of node.params || []) {
        const annotation = "typeAnnotation" in param ? param.typeAnnotation : undefined
        const type = annotation?.typeAnnotation
        if (type?.type === "TSTypeLiteral" || type?.type === "TSIntersectionType" && type.types.some((item) => item.type === "TSTypeLiteral")) {
          context.report({ node: annotation || param, messageId: "inline" })
        }
      }
    }
    return { ArrowFunctionExpression: check, FunctionExpression: check, FunctionDeclaration: check }
  },
})

const isExported = (node: Node): boolean => node.parent?.type === "ExportNamedDeclaration" || node.parent?.parent?.type === "ExportNamedDeclaration"
const containsJsx = (node: unknown, seen: Set<unknown> = new Set()): boolean => {
  if (!node || typeof node !== "object" || seen.has(node)) return false
  seen.add(node)
  if ("type" in node && (node.type === "JSXElement" || node.type === "JSXFragment")) return true
  return Object.entries(node).some(([key, value]) => key !== "parent" && (Array.isArray(value) ? value.some((item) => containsJsx(item, seen)) : containsJsx(value, seen)))
}
const componentNameOf = (node: TSESTree.VariableDeclarator): string | null => {
  if (node.type !== "VariableDeclarator" || node.id?.type !== "Identifier" || !/^[A-Z]/.test(node.id.name) || !isExported(node)) return null
  return node.id.name
}

/** Require exported React components to take no parameter, or one named props parameter. */
export const publicComponentSignature = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Exported React components take no parameter, or one parameter named props with a matching XProps type (XBase may also take XBaseProps)." },
    schema: [],
    messages: {
      parameter: "Exported component {{name}} must be an arrow const with no parameter, or exactly one parameter named props.",
      type: "Exported component {{name}} must type props as {{expected}}.",
    },
  },
  create(context) {
    const check = (name: string | null, fn: TSESTree.ArrowFunctionExpression | null | undefined): void => {
      if (!name || !fn) return
      const params = fn.params || []
      if (params.length === 0) return
      const [param] = params
      if (params.length !== 1 || param?.type !== "Identifier" || param.name !== "props") {
        context.report({ node: fn, messageId: "parameter", data: { name } })
        return
      }
      const type = param.typeAnnotation?.typeAnnotation
      // XBase pairs with XBaseProps so the connected X keeps XProps for itself; XProps stays accepted for
      // existing twins.
      const expected = name.endsWith("Base") ? [`${name}Props`, `${name.slice(0, -4)}Props`] : [`${name}Props`]
      const actual = type?.type === "TSTypeReference" && type.typeName?.type === "Identifier" ? type.typeName.name : null
      if (!actual || !expected.includes(actual)) context.report({ node: param, messageId: "type", data: { name, expected: expected.join(" or ") } })
    }
    if (!isComponentFile(context)) return {}
    return {
      VariableDeclarator(node) {
        const name = componentNameOf(node)
        if (name && node.init?.type === "ArrowFunctionExpression" && containsJsx(node.init)) check(name, node.init)
      },
      FunctionDeclaration(node) {
        if (!isExported(node) || !containsJsx(node)) return
        context.report({ node, messageId: "parameter", data: { name: node.id?.name || "component" } })
      },
    }
  },
})

/** Prevent callers from styling internal component parts through named CSS props. */
export const noPerPartClassNameProp = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Components do not expose per-part class name props." },
    schema: [],
    messages: { perPart: "Keep internal part styling owned by the component." },
  },
  create(context) {
    if (!isComponentFile(context)) return {}
    return { TSPropertySignature(node) { const name = propertyName(node); if (name && name !== "className" && /^[a-z][A-Za-z0-9]*ClassName$/.test(name)) context.report({ node, messageId: "perPart" }) } }
  },
})

/** Keep component appearance local instead of exposing className placement doors. */
export const noPublicClassNameProp = defineRule({
  meta: {
    type: "problem",
    docs: { description: "House components do not expose className or classNames props." },
    schema: [],
    messages: { declaration: "Component props must not expose {{prop}}.", usage: "Do not pass {{prop}} to house component {{component}}." },
  },
  create(context) {
    const declared = isComponentFile(context)
    /** A house component: the identifier resolves (through its import) to a file of a component layer. */
    const isHouseComponent = (identifier: TSESTree.JSXIdentifier): boolean => declarationsOf(context, identifier).some((declaration) => isComponentPath(context, declarationFile(declaration)))
    return {
      TSPropertySignature(node) { if (declared && ["className", "classNames"].includes(propertyName(node) ?? "")) context.report({ node, messageId: "declaration", data: { prop: propertyName(node) } }) },
      JSXOpeningElement(node) {
        const identifier = node.name?.type === "JSXIdentifier" ? node.name : null
        if (!identifier) return
        const styled = (node.attributes || []).filter((attribute): attribute is TSESTree.JSXAttribute & { name: TSESTree.JSXIdentifier } => attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && ["className", "classNames"].includes(attribute.name.name))
        if (styled.length === 0 || !isHouseComponent(identifier)) return
        for (const attribute of styled) context.report({ node: attribute, messageId: "usage", data: { prop: attribute.name.name, component: identifier.name } })
      },
    }
  },
})

/** Keep layout APIs semantic rather than exposing raw CSS decisions above leaves. */
export const noPublicFrameCssProps = defineRule({
  meta: { type: "problem", docs: { description: "Non-leaf component props do not expose CSS-shaped frame decisions." }, schema: [], messages: { css: "Move {{prop}} into component-owned layout behavior." } },
  create(context) {
    if (!isComponentFile(context) || kindOfFile(context) === "leaves") return {}
    const cssProps = new Set(["gap", "padding", "align", "justify", "className", "classNames", "style", "inline", "nested"])
    return { TSPropertySignature(node) { const name = propertyName(node); if (name !== null && cssProps.has(name)) context.report({ node, messageId: "css", data: { prop: name } }) } }
  },
})

/** Prevent utility types from reintroducing public styling doors. */
export const noCssDoorTypeLaundering = defineRule({
  meta: { type: "problem", docs: { description: "Omit, Pick, and Exclude cannot hide styling props." }, schema: [], messages: { utility: "Remove {{prop}} from the owning public type instead of hiding it with {{utility}}." } },
  create(context) {
    if (!isProductSource(context)) return {}
    return { TSTypeReference(node) { const utility = node.typeName.type === "Identifier" ? node.typeName.name : null; const params = node.typeArguments?.params || []; if (!utility || !["Omit", "Pick", "Exclude"].includes(utility)) return; const second = params[1]; const keys = second?.type === "TSLiteralType" ? [literalValue(second)] : second !== undefined && "types" in second ? second.types.map((item) => (item.type === "TSLiteralType" ? literalValue(item) : undefined)) : []; const prop = keys.find((key): key is string => typeof key === "string" && ["className", "classNames", "style"].includes(key)); if (prop) context.report({ node, messageId: "utility", data: { utility, prop } }) } }
  },
})

/** The top-level declaration of a type name in this file (`interface X` or `type X = ...`), or null. */
/** The value a literal type spells (`"a"`, `1`, `true`); undefined for a template or unary literal type. */
const literalValue = (type: TSESTree.TSLiteralType): unknown => ("value" in type.literal ? type.literal.value : undefined)

/** A local type declaration: an interface or a type alias. */
type LocalTypeDeclaration = TSESTree.TSInterfaceDeclaration | TSESTree.TSTypeAliasDeclaration

/**
 * A props type as the walker meets it: a type node, or the reference an interface's `extends` clause spells, which reports
 * on that clause.
 */
type PropsType = TSESTree.TypeNode | HeritageReference

/** The reference an interface heritage clause spells. */
interface HeritageReference {
  readonly type: "TSTypeReference"
  readonly typeName: TSESTree.Identifier
  readonly typeArguments: TSESTree.TSTypeParameterInstantiation | undefined
  readonly heritage: TSESTree.TSInterfaceHeritage
}

/** The node a finding on a props type is reported on. */
const reportedNode = (type: PropsType): Node => ("heritage" in type ? type.heritage : type)

const localTypeDeclaration = (program: TSESTree.Program, name: string): LocalTypeDeclaration | null => {
  for (const statement of program.body) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement
    if ((declaration?.type === "TSInterfaceDeclaration" || declaration?.type === "TSTypeAliasDeclaration") && declaration.id.name === name) return declaration
  }
  return null
}

/** The type the first parameter of a function declares, or null. */
/** A function that renders: an arrow, an expression or a declaration. */
type Renderer = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | TSESTree.FunctionDeclaration

const firstParameterType = (fn: Renderer): TSESTree.TypeNode | null => {
  const param = fn.params[0]
  const annotated = param?.type === "AssignmentPattern" ? param.left : param
  return annotated !== undefined && "typeAnnotation" in annotated ? annotated.typeAnnotation?.typeAnnotation ?? null : null
}

/** The exported functions of a file that render (contain JSX): a component, whatever it is called. */
const exportedRenderers = (program: TSESTree.Program): Renderer[] => program.body.flatMap((statement): Renderer[] => {
  const declaration = statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration" ? statement.declaration : null
  if (!declaration) return []
  const functions = declaration.type === "VariableDeclaration"
    ? declaration.declarations.map((item) => item.init).filter((init): init is TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression => init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression")
    : declaration.type === "FunctionDeclaration" || declaration.type === "ArrowFunctionExpression" || declaration.type === "FunctionExpression" ? [declaration] : []
  return functions.filter((fn) => fn.params.length === 1 && containsJsx(fn.body))
})

/** Props are readonly all the way down: every field, index signature, nested object and collection (FE-TYPING-2). */
export const propsFieldsReadonly = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Every field of a component's props type, nested objects and collections included, is readonly." },
    schema: [],
    messages: {
      field: "Props field `{{name}}` is not readonly. A component reads its props and never writes them: mark it `readonly` so a write is a type error.",
      index: "This props index signature is not readonly. Mark it `readonly [key: ...]` so no entry can be written through props.",
      collection: "This props collection is mutable. Write `readonly T[]`, `readonly [A, B]` or `ReadonlyArray<T>` so the component cannot change what it was given.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const sourceCode = context.sourceCode || context.getSourceCode()
    return {
      "Program:exit"(program) {
        const seen = new Set<unknown>()
        /** Checks one type: object members, collections and the local declarations it names. */
        const checkType = (type: PropsType | null | undefined): void => {
          if (!type || seen.has(type)) return
          seen.add(type)
          if (type.type === "TSTypeOperator" && type.operator === "readonly") {
            checkElements(type.typeAnnotation)
            return
          }
          if (type.type === "TSArrayType" || type.type === "TSTupleType") {
            context.report({ node: type, messageId: "collection" })
            checkElements(type)
            return
          }
          if (type.type === "TSUnionType" || type.type === "TSIntersectionType") {
            for (const part of type.types) checkType(part)
            return
          }
          if (type.type === "TSTypeLiteral") {
            checkMembers(type.members)
            return
          }
          if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier") return
          const name = type.typeName.name
          const args = type.typeArguments?.params ?? []
          // `Readonly<T>` makes the top level readonly; what T nests is still judged
          if (name === "Readonly" && args.length === 1 && !isShadowed(type.typeName)) {
            checkNested(args[0])
            return
          }
          if (name === "Array" && !isShadowed(type.typeName)) context.report({ node: reportedNode(type), messageId: "collection" })
          if ((name === "Array" || name === "ReadonlyArray") && !isShadowed(type.typeName)) {
            for (const arg of args) checkType(arg)
            return
          }
          const declaration = localTypeDeclaration(program, name)
          if (!declaration || seen.has(declaration)) return
          seen.add(declaration)
          if (declaration.type === "TSTypeAliasDeclaration") checkType(declaration.typeAnnotation)
          else {
            checkMembers(declaration.body.body)
            for (const heritage of declaration.extends ?? []) {
              if (heritage.expression.type === "Identifier") checkType({ type: "TSTypeReference", typeName: heritage.expression, typeArguments: heritage.typeArguments, heritage })
            }
          }
        }
        /** The element types of a collection, judged like any other props type. */
        const checkElements = (collection: TSESTree.TypeNode | undefined): void => {
          if (collection?.type === "TSArrayType") checkType(collection.elementType)
          else if (collection?.type === "TSTupleType") for (const element of collection.elementTypes) checkType(element.type === "TSNamedTupleMember" ? element.elementType : element)
          else checkType(collection)
        }
        /** A `Readonly<T>` argument: its own fields are readonly, its nested values are judged. */
        const checkNested = (type: TSESTree.TypeNode | undefined): void => {
          if (type?.type === "TSTypeLiteral") for (const member of type.members) checkType("typeAnnotation" in member ? member.typeAnnotation?.typeAnnotation : undefined)
          else checkType(type)
        }
        const checkMembers = (members: readonly TSESTree.TypeElement[]): void => {
          for (const member of members) {
            if (member.type === "TSPropertySignature") {
              if (!member.readonly) context.report({ node: member, messageId: "field", data: { name: sourceCode.getText(member.key) } })
              checkType(member.typeAnnotation?.typeAnnotation)
            } else if (member.type === "TSIndexSignature") {
              if (!member.readonly) context.report({ node: member, messageId: "index" })
              checkType(member.typeAnnotation?.typeAnnotation)
            }
          }
        }
        /** True when a built-in name is redeclared in this file, so it is not the built-in. */
        const isShadowed = (identifier: TSESTree.Identifier): boolean => localTypeDeclaration(program, identifier.name) !== null
        for (const fn of exportedRenderers(program)) checkType(firstParameterType(fn))
      },
    }
  },
})

export const rules: Rules = {
  "no-inline-parameter-type": noInlineParameterType,
  "props-fields-readonly": propsFieldsReadonly,
  "public-component-signature": publicComponentSignature,
  "no-per-part-classname-prop": noPerPartClassNameProp,
  "no-public-classname-prop": noPublicClassNameProp,
  "no-public-frame-css-props": noPublicFrameCssProps,
  "no-css-door-type-laundering": noCssDoorTypeLaundering,
}

/** All rules in this law are mechanical errors once adopted. */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error" as const]))
