/**
 * The rules that hold the drawing law (the `drawing` slot role: a surface's pure `component.tsx`).
 *
 * TWO AXES, AND ONLY ONE IS DRAWN. A surface's `shape` is its SHAPE: a layout the owner approves as
 * one drawing. A slot's data status (loading, forbidden, error, empty) is not a shape; it is a
 * status recipe applied per resource, and it is never a drawn shape. Mixing the two is what made
 * every block ship four hand-drawn variants that disagreed with each other.
 *
 * THE PURE HALF TAKES ATOMS. `component.tsx` receives `{ shape?, props, on? }`: `props` is data
 * (strings, numbers, booleans, arrays, plain objects), `on` is actions whose arguments are data,
 * and feature composition may also take named `render` callbacks inside `props` to render supplied
 * blocks. A layout alone also takes `children`, because the router puts the page there.
 *
 * ONLY ITS OWN INDEX MAY IMPORT IT. Other tiers use the connected export, so the pure half stays a
 * private drawing surface that audit can render from a fixture.
 *
 * Every rule reads one file. Types imported from elsewhere are trusted as data; only names this
 * file declares are followed, which is exact for the tree the convention produces and silent,
 * never wrong, beyond it.
 */

import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import { defineRule, type Node, type Rules, type Recommended } from "./lib/rule.ts"
import { classifyImport, roleOfFile } from "./lib/scope.ts"

import { inSplitTier, pureHalf } from "./lib/drawing-scope.ts"

/** Type names that carry a rendered tree rather than data. */
const NON_ATOM_TYPE = /^(?:ReactNode|ReactElement|ReactPortal|JSX\.Element|Element|ComponentType|FC|FunctionComponent|ElementType|ComponentProps|RenderFunction)$/

/** Feature composition's render callbacks return a rendered value and take only data. */
const RENDER_RESULT_TYPE = /^(?:ReactNode|ReactElement|JSX\.Element)$/
const RENDER_PROP_NAME = /^render(?:[A-Z][A-Za-z0-9]*)?$/

/** The printed name of a type reference, qualified names included. */
/** A type the pure contract is read from: a type node, or the body of a local interface. */
type TypeShape = TSESTree.TypeNode | TSESTree.TSInterfaceBody

/** The local type declarations of a file, by name. */
type LocalTypes = Map<string, TypeShape>

/** The declared type of a parameter, or undefined. */
const parameterType = (parameter: TSESTree.Parameter | undefined): TSESTree.TypeNode | undefined =>
  parameter !== undefined && "typeAnnotation" in parameter ? parameter.typeAnnotation?.typeAnnotation : undefined

/** The name of a parameter that is a plain identifier, or undefined. */
const parameterName = (parameter: TSESTree.Parameter): string | undefined => ("name" in parameter ? parameter.name : undefined)

/** The declared type of a member of an object type, or undefined. */
const memberType = (member: TSESTree.TypeElement): TSESTree.TypeNode | undefined =>
  "typeAnnotation" in member ? member.typeAnnotation?.typeAnnotation : undefined

const typeNameOf = (node: { readonly typeName?: TSESTree.EntityName } | null | undefined): string => {
  const name = node?.typeName
  if (!name) return ""
  if (name.type === "Identifier") return name.name
  if (name.type === "TSQualifiedName") return `${typeNameOf({ typeName: name.left })}.${name.right.name}`
  return ""
}

/** Every type this file declares, by name, so references can be followed locally. */
const collectLocalTypes = (program: TSESTree.Program): LocalTypes => {
  const types: LocalTypes = new Map()
  const visit = (statement: TSESTree.ProgramStatement): void => {
    const declaration = statement?.type === "ExportNamedDeclaration" ? statement.declaration : statement
    if (declaration?.type === "TSTypeAliasDeclaration") types.set(declaration.id.name, declaration.typeAnnotation)
    if (declaration?.type === "TSInterfaceDeclaration") types.set(declaration.id.name, declaration.body)
  }
  for (const statement of program.body) visit(statement)
  return types
}

/** The members of an object-shaped type node, following local names and intersections. */
const membersOf = (node: TypeShape | null | undefined, types: LocalTypes, seen: Set<string> = new Set()): TSESTree.TypeElement[] => {
  if (!node) return []
  if (node.type === "TSTypeLiteral") return node.members
  if (node.type === "TSInterfaceBody") return node.body
  if (node.type === "TSIntersectionType") return node.types.flatMap((part) => membersOf(part, types, seen))
  if (node.type === "TSTypeReference") {
    const name = typeNameOf(node)
    if (seen.has(name) || !types.has(name)) return []
    seen.add(name)
    return membersOf(types.get(name), types, seen)
  }
  return []
}

/** The key a property signature declares. */
const keyOf = (member: TSESTree.TypeElement): unknown => {
  const key = "key" in member ? member.key : undefined
  return key?.type === "Identifier" ? key.name : key !== undefined && "value" in key ? key.value : undefined
}

// -- DRAWING-1 ----------------------------------------------------------------------------------

/** The pure half takes atom data and actions; feature composition may receive named render callbacks. */
export const basePropsAtom = defineRule({
  meta: {
    type: "problem",
    docs: { description: "A pure `XBase` takes `shape`, atom `props` and `on` actions; feature composition may receive named render callbacks in `props`." },
    fixable: "code",
    schema: [],
    messages: {
      tree:
        "`{{path}}` hands a rendered tree (`{{type}}`) into the pure half. Write the child inside `component.tsx` and pass it atoms (ids, strings, flags); a tree handed in cannot be drawn, audited or reused.",
      action:
        "`{{path}}` is a function inside `props`. Actions live in `on`; feature composition may receive named `render` callbacks that take atoms and return rendered blocks.",
      onData:
        "`on.{{key}}` is not an action. `on` holds functions only; data belongs in `props`.",
      member:
        "`{{key}}` is not part of the pure contract. A pure half takes `shape`, `props` and `on`{{children}}.",
      renamed:
        "`state` is the retired name of the drawn shape: rename it `shape` (owner ruling fe-shape-not-state).",
    },
  },
  create(context) {
    const tier = pureHalf(context)
    if (!tier) return {}
    let types: LocalTypes = new Map()

    /** Resolve render results locally; an optional empty result does not make data a render prop. */
    const isRenderResult = (node: TypeShape | null | undefined, seen: Set<string> = new Set()): boolean => {
      if (!node) return false
      if (node.type === "TSUnionType") {
        const empty = (part: TSESTree.TypeNode): boolean => ["TSNullKeyword", "TSUndefinedKeyword"].includes(part.type)
          || part.type === "TSLiteralType" && "value" in part.literal && part.literal.value === null
        return node.types.some((part) => isRenderResult(part, new Set(seen)))
          && node.types.every((part) => empty(part) || isRenderResult(part, new Set(seen)))
      }
      if (node.type !== "TSTypeReference") return false
      const name = typeNameOf(node)
      if (RENDER_RESULT_TYPE.test(name.replace(/^React\./, ""))) return true
      if (!types.has(name) || seen.has(name)) return false
      return isRenderResult(types.get(name), new Set(seen).add(name))
    }

    const checkRenderCallback = (node: TSESTree.TSFunctionType | TSESTree.TSMethodSignature, path: string, allowed: boolean): boolean => {
      if (!allowed || !isRenderResult(node.returnType?.typeAnnotation)) return false
      for (const parameter of node.params) {
        checkData(parameterType(parameter), `${path}(${parameterName(parameter) ?? "arg"})`, new Set(), false, true)
      }
      return true
    }

    const checkDataReference = (node: TSESTree.TSTypeReference, path: string, seen: Set<string>, renderProp: boolean, renderParameter: boolean): void => {
      const name = typeNameOf(node)
      if (NON_ATOM_TYPE.test(renderParameter ? name.replace(/^React\./, "") : name)) {
        context.report({ node, messageId: "tree", data: { path, type: name } })
        return
      }
      for (const argument of node.typeArguments?.params ?? []) checkData(argument, path, seen, false, renderParameter)
      if (types.has(name) && !seen.has(name)) {
        const nextSeen = renderProp || renderParameter ? new Set(seen) : seen
        nextSeen.add(name)
        checkData(types.get(name), path, nextSeen, renderProp, renderParameter)
      }
    }

    const checkDataMember = (member: TSESTree.TypeElement, path: string, seen: Set<string>, renderParameter: boolean): void => {
      const memberPath = `${path}.${String(keyOf(member))}`
      const allowsRender = tier !== "blocks" && path === "props" && RENDER_PROP_NAME.test(String(keyOf(member)))
      if (member.type === "TSMethodSignature") {
        if (!checkRenderCallback(member, memberPath, allowsRender)) context.report({ node: member, messageId: "action", data: { path: memberPath } })
      } else if (member.type === "TSPropertySignature") {
        checkData(memberType(member), memberPath, seen, allowsRender, renderParameter)
      }
    }

    /** Walk a data type: report trees and functions anywhere inside it. */
    const checkData = (node: TypeShape | null | undefined, path: string, seen: Set<string>, renderProp = false, renderParameter = false): void => {
      if (!node) return
      switch (node.type) {
        case "TSFunctionType":
          if (checkRenderCallback(node, path, renderProp)) return
          context.report({ node, messageId: "action", data: { path } })
          return
        case "TSTypeReference":
          checkDataReference(node, path, seen, renderProp, renderParameter)
          return
        case "TSUnionType":
        case "TSIntersectionType":
          for (const part of node.types) checkData(part, path, seen, renderProp, renderParameter)
          return
        case "TSArrayType":
          checkData(node.elementType, path, seen, false, renderParameter)
          return
        case "TSTypeOperator":
          checkData(node.typeAnnotation, path, seen, false, renderParameter)
          return
        case "TSTypeLiteral":
        case "TSInterfaceBody":
          for (const member of node.type === "TSTypeLiteral" ? node.members : node.body) checkDataMember(member, path, seen, renderParameter)
          return
        default:
      }
    }

    /** Walk `on`: every member is a function whose parameters are data. */
    const checkActions = (node: TypeShape | undefined): void => {
      for (const member of membersOf(node, types)) {
        const key = keyOf(member)
        const type = member.type === "TSMethodSignature" ? member : memberType(member)
        if (type?.type !== "TSFunctionType" && type?.type !== "TSMethodSignature") {
          context.report({ node: member, messageId: "onData", data: { key } })
          continue
        }
        for (const parameter of type.params) {
          checkData(parameterType(parameter), `on.${String(key)}(${parameterName(parameter) ?? "arg"})`, new Set())
        }
      }
    }

    return {
      Program(node) {
        types = collectLocalTypes(node)
      },
      VariableDeclarator(node) {
        if (node.id?.type !== "Identifier" || !/^[A-Z][A-Za-z0-9]*Base$/.test(node.id.name)) return
        const fn = node.init
        if (fn?.type !== "ArrowFunctionExpression" && fn?.type !== "FunctionExpression") return
        const annotation = parameterType(fn.params[0])
        for (const member of membersOf(annotation, types)) {
          const key = keyOf(member)
          const type = memberType(member)
          if (key === "shape") continue
          if (key === "state") {
            const stateKey = "key" in member ? member.key : undefined
            context.report({
              node: member,
              messageId: "renamed",
              ...(stateKey?.type === "Identifier" ? { fix: (fixer: TSESLint.RuleFixer) => fixer.replaceText(stateKey, "shape") } : {}),
            })
            continue
          }
          if (key === "props") checkData(type, "props", new Set())
          else if (key === "on") checkActions(type)
          else if (key === "children" && tier === "layouts") continue
          else {
            context.report({
              node: member,
              messageId: "member",
              data: { key, children: tier === "layouts" ? ", plus the router's `children`" : "" },
            })
          }
        }
      },
    }
  },
})

/** The name of an export specifier's identifier; undefined for a string-literal name. */
const identifierName = (node: TSESTree.Identifier | TSESTree.StringLiteral): string | undefined => (node.type === "Identifier" ? node.name : undefined)

// -- DRAWING-2 ----------------------------------------------------------------------------------

/** Only the sibling `index.tsx` (and its specs) may reach `component.tsx`; only `X` leaves the folder. */
export const baseImportPair = defineRule({
  meta: {
    type: "problem",
    docs: { description: "A pure `component.tsx` is imported only by its sibling `index.tsx`, which never re-exports `XBase`." },
    schema: [],
    messages: {
      reach:
        "`{{source}}` reaches into another surface's pure half. Import that surface's connected export from its folder; the pure half is a private drawing surface.",
      reexport:
        "`index.tsx` re-exports `{{name}}`. The folder exports only its connected `X`; the pure `XBase` stays behind it so no other tier can bypass the owner.",
    },
  },
  create(context) {
    const isOwnIndex = roleOfFile(context) === "entry"
    const inTier = inSplitTier(context)
    // An import reaches a pure half when the file it resolves to has the `drawing` role of its slot.
    const reachesPure = (source: string): boolean => classifyImport(context, source)?.role === "drawing"

    const check = (node: Node, source: unknown): void => {
      if (typeof source !== "string" || !reachesPure(source)) return
      const isSibling = /^\.\/[^/]+$/.test(source)
      if (isSibling && isOwnIndex) return
      if (isSibling && !inTier) return
      context.report({ node, messageId: "reach", data: { source } })
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source?.value)
      },
      ExportAllDeclaration(node) {
        check(node, node.source?.value)
      },
      ExportNamedDeclaration(node) {
        const source = node.source?.value
        if (!source) return
        check(node, source)
        if (!isOwnIndex || !inTier || node.exportKind === "type") return
        for (const specifier of node.specifiers ?? []) {
          const name = identifierName(specifier.exported) ?? identifierName(specifier.local)
          if (specifier.exportKind !== "type" && name !== undefined && /^[A-Z][A-Za-z0-9]*Base$/.test(name)) {
            context.report({ node: specifier, messageId: "reexport", data: { name } })
          }
        }
      },
    }
  },
})

// -- DRAWING-3 ----------------------------------------------------------------------------------

/** Words that name a data status or an open/closed lifecycle, never a drawn shape. */
const DATA_STATUS = new Set([
  "pending", "loading", "failed", "error", "errored", "empty", "forbidden", "unavailable",
  "skeleton", "closed", "idle", "refreshing", "retrying",
])

/** The name of a pure half's shape union: `XShape`, and still the retired `XState`, so a status word is caught during the rename. */
const SHAPE_NAME = /^[A-Z][A-Za-z0-9]*(?:Shape|State)$/

/** A boolean member that names a status or an open/closed lifecycle: `isOpen`, `isLoading`, `isRenewing`. */
const STATUS_FLAG = /^is[A-Z]/

/** A surface's `XShape` names drawn shapes only: no data status, no open/closed, no status flag. */
export const noDataStatusShape = defineRule({
  meta: {
    type: "problem",
    docs: { description: "`XShape` of a pure half (a union, an interface or an inline `shape` object) names drawn shapes, never a data status, open/closed or a status flag." },
    schema: [],
    messages: {
      status:
        "`{{name}}` lists \"{{value}}\" as a shape. Loading, forbidden, error and empty describe resource status: pass them as data to the owned status renderer. Open/closed is a boolean atom. A shape is a layout the owner approves as one drawing.",
      flag:
        "`{{name}}` carries the flag `{{key}}`. A shape names a drawing, never a status or open/closed flag: a read's status goes through its DataSlot and SlotView, a pending mutation is a prop of its control, and open/closed is a boolean atom in `props`.",
    },
  },
  create(context) {
    if (!pureHalf(context)) return {}
    const checkMembers = (name: string, members: readonly TSESTree.TypeElement[]): void => {
      for (const member of members) {
        const key = keyOf(member)
        const type = memberType(member)
        if ((typeof key === "string" && STATUS_FLAG.test(key)) || type?.type === "TSBooleanKeyword") {
          context.report({ node: member, messageId: "flag", data: { name, key: String(key) } })
        } else if (type !== undefined) {
          check(name, type)
        }
      }
    }
    const check = (name: string, node: TSESTree.TypeNode): void => {
      if (node.type === "TSTypeLiteral") {
        checkMembers(name, node.members)
        return
      }
      const members = node.type === "TSUnionType" ? node.types : [node]
      for (const member of members) {
        if (member.type === "TSTypeLiteral") {
          checkMembers(name, member.members)
          continue
        }
        const value = member.type === "TSLiteralType" && "value" in member.literal ? member.literal.value : undefined
        if (typeof value === "string" && DATA_STATUS.has(value)) {
          context.report({ node: member, messageId: "status", data: { name, value } })
        }
      }
    }
    return {
      TSTypeAliasDeclaration(node) {
        if (SHAPE_NAME.test(node.id.name)) check(node.id.name, node.typeAnnotation)
      },
      TSInterfaceDeclaration(node) {
        if (SHAPE_NAME.test(node.id.name)) checkMembers(node.id.name, node.body.body)
      },
      TSPropertySignature(node) {
        const type = node.typeAnnotation?.typeAnnotation
        if (keyOf(node) !== "shape" || type === undefined || type.type === "TSTypeReference") return
        check("shape", type)
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Rules = {
  "base-props-atom": basePropsAtom,
  "base-import-pair": baseImportPair,
  "no-data-status-shape": noDataStatusShape,
}

/** Every FE canon rule is an error; existing debt is fixed before adoption. */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error" as const]))
