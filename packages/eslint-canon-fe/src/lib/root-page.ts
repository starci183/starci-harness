/**
 * The one-level connected page composition of FE-FUNCTION-2 / R325. The selected
 * canonical catalog owns renderer spellings; this reader owns the source proof.
 * No app setting, component name or unused JSX grants a block a content door.
 */
import fs from "node:fs"
import path from "node:path"
import type { TSESTree } from "@typescript-eslint/utils"
import { grammarContractFor } from "@starci/hfs/runtime/scripts/lib/grammar-lint.mjs"
import { attribute, attributeValue, walk } from "./ast.ts"
import { importOf, isFn, unwrap, variableOf } from "./bindings.ts"
import { hfsOf } from "./hfs.ts"
import { preservesPageBody, parameterMember } from "./page-body.ts"
import { headerExport, importedHeader, parsedSource, type Owner } from "./owner-source.ts"
import type { AnyContext, Node } from "./rule.ts"

const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value)

/** A selected public semantic role, never a lexical JSX name. Unknown roles refuse. */
export const isPageRenderer = (context: AnyContext, opening: TSESTree.JSXOpeningElement): boolean => {
  const family = hfsOf(context).grammar
  if (!family) return false
  const contract = grammarContractFor(family)
  const roles = contract.semanticRoles
  const role = record(roles) ? roles.page : null
  if (!record(role) || typeof role.export !== "string" || !Array.isArray(role.entries) || !role.entries.every((entry) => typeof entry === "string"))
    return false
  const name = opening.name
  const identifier =
    name.type === "JSXIdentifier" ? name : name.type === "JSXMemberExpression" && name.object.type === "JSXIdentifier" ? name.object : null
  if (!identifier) return false
  const origin = importOf(context, identifier)
  const definition = variableOf(context, identifier)?.defs.find((item) => item.type === "ImportBinding")
  if (
    !origin ||
    definition?.type !== "ImportBinding" ||
    definition.parent.importKind === "type" ||
    (definition.node.type === "ImportSpecifier" && definition.node.importKind === "type")
  )
    return false
  const exported = name.type === "JSXMemberExpression" && definition.node.type === "ImportNamespaceSpecifier" ? name.property.name : origin.imported
  return exported === role.export && role.entries.some((entry: string) => origin.source === entry.replace("<family>", family))
}

/** Resolve only actual immutable value aliases of the selected public export. */
const resolvedOwner = (owner: Owner | null, seen = new Set<Node>()): Owner | null => {
  if (!owner || seen.has(owner.value)) return null
  const value = unwrap(owner.value)
  if (isFn(value)) return { ...owner, value }
  if (value.type !== "Identifier") return null
  const definition = variableOf(owner.context, value)?.defs[0]
  if (definition?.type === "FunctionName" && isFn(definition.node)) return { ...owner, value: definition.node }
  if (definition?.type !== "Variable" || definition.parent.kind !== "const" || !definition.node.init) return null
  return resolvedOwner({ ...owner, value: definition.node.init }, new Set(seen).add(owner.value))
}

/** Constant branch conditions have their actual meaning; unknown expressions are never guessed. */
const constantBoolean = (context: AnyContext, node: Node, seen = new Set<Node>()): boolean | null => {
  if (seen.has(node)) return null
  const visited = new Set(seen).add(node)
  const value = unwrap(node)
  if (value.type === "Literal" && typeof value.value === "boolean") return value.value
  if (value.type === "Identifier") {
    const definition = variableOf(context, value)?.defs[0]
    return definition?.type === "Variable" && definition.parent.kind === "const" && definition.node.init
      ? constantBoolean(context, definition.node.init, visited)
      : null
  }
  if (value.type === "UnaryExpression" && value.operator === "!") {
    const inner = constantBoolean(context, value.argument, visited)
    return inner === null ? null : !inner
  }
  return null
}

interface Returns {
  readonly values: readonly Node[]
  readonly fallsThrough: boolean
}

/** Walk control flow, stopping after a return/throw and refusing unsupported return-bearing control flow. */
const returnedStatements = (context: AnyContext, statements: readonly TSESTree.Statement[]): Returns | null => {
  const values: Node[] = []
  const branch = (statement: TSESTree.Statement): Returns | null =>
    returnedStatements(context, statement.type === "BlockStatement" ? statement.body : [statement])
  for (const statement of statements) {
    if (statement.type === "ReturnStatement")
      return statement.argument ? { values: [...values, unwrap(statement.argument)], fallsThrough: false } : null
    if (statement.type === "ThrowStatement") return { values, fallsThrough: false }
    if (statement.type === "IfStatement") {
      const known = constantBoolean(context, statement.test)
      const left = known === false ? { values: [], fallsThrough: true } : branch(statement.consequent)
      const right = known === true || !statement.alternate ? { values: [], fallsThrough: true } : branch(statement.alternate)
      if (!left || !right) return null
      values.push(...left.values, ...right.values)
      const fallsThrough = known === true ? left.fallsThrough : known === false ? right.fallsThrough : left.fallsThrough || right.fallsThrough
      if (!fallsThrough) return { values, fallsThrough: false }
      continue
    }
    if (statement.type === "BlockStatement") {
      const nested = returnedStatements(context, statement.body)
      if (!nested) return null
      values.push(...nested.values)
      if (!nested.fallsThrough) return { values, fallsThrough: false }
      continue
    }
    if (
      ![
        "VariableDeclaration",
        "ExpressionStatement",
        "FunctionDeclaration",
        "EmptyStatement",
        "DebuggerStatement",
        "TSTypeAliasDeclaration",
        "TSInterfaceDeclaration"
      ].includes(statement.type)
    )
      return null
  }
  return { values, fallsThrough: true }
}

/** Return expressions of this function only: nested helpers and dead JSX do not draw it. */
const returned = (owner: Owner): readonly Node[] | null => {
  const value = owner.value
  if (!isFn(value)) return null
  if (value.body.type !== "BlockStatement") return [unwrap(value.body)]
  const result = returnedStatements(owner.context, value.body.body)
  return result && !result.fallsThrough ? result.values : null
}

/** Empty non-rendering arms are allowed; every rendering arm has exactly one root. */
const roots = (owner: Owner): readonly TSESTree.JSXElement[] | null => {
  const values = returned(owner)
  if (!values) return null
  const found: TSESTree.JSXElement[] = []
  const add = (node: Node): boolean => {
    if (node.type === "Literal" && (node.value === null || node.value === false)) return true
    if (node.type === "ConditionalExpression") {
      const known = constantBoolean(owner.context, node.test)
      if (known !== null) return add(unwrap(known ? node.consequent : node.alternate))
      return add(unwrap(node.consequent)) && add(unwrap(node.alternate))
    }
    if (node.type === "JSXElement") {
      found.push(node)
      return true
    }
    if (node.type !== "JSXFragment") return false
    const children = node.children.filter((child) => child.type !== "JSXText" || child.value.trim() !== "")
    return children.length === 1 && children[0]?.type === "JSXElement" && add(children[0])
  }
  return values.every(add) && found.length > 0 ? found : null
}

const sameOwner = (left: Owner, right: Owner): boolean =>
  path.resolve(left.context.filename) === path.resolve(right.context.filename) && left.value.range[0] === right.value.range[0]

/** Exactly the selected sibling drawing, not any import whose filename resembles it. */
const ownDrawing = (owner: Owner): Owner | null => {
  const entry = resolvedOwner(owner)
  if (!entry) return null
  const elements = roots(entry)
  if (!elements) return null
  let drawing: Owner | null = null
  for (const element of elements) {
    const imported = resolvedOwner(importedHeader(entry.context, element.openingElement))
    if (
      !imported ||
      path.dirname(imported.context.filename) !== path.dirname(entry.context.filename) ||
      hfsOf(entry.context).classify(imported.context.filename).role !== "drawing"
    )
      return null
    if (element.openingElement.attributes.some((item) => item.type === "JSXSpreadAttribute")) return null
    if (drawing && !sameOwner(drawing, imported)) return null
    drawing = imported
  }
  return drawing
}

/** The Page is the returned root on every drawing path, not a nested or unused renderer. */
const pagesOf = (drawing: Owner): readonly TSESTree.JSXElement[] | null => {
  const elements = roots(drawing)
  if (!elements || !elements.every((element) => isPageRenderer(drawing.context, element.openingElement))) return null
  let nested = false
  for (const page of elements)
    walk(drawing.context.sourceCode, page, (node) => {
      if (node !== page && node.type === "JSXElement" && isPageRenderer(drawing.context, node.openingElement)) nested = true
    })
  return nested ? null : elements
}

/** A segment's link tabs are a fact of its selected renderer API, owned by the catalog. */
const segmentDrawing = (drawing: Owner): boolean => {
  const family = hfsOf(drawing.context).grammar
  if (!family) return false
  const roles = grammarContractFor(family).semanticRoles
  const role = record(roles) ? roles.page : null
  const segment = record(role) ? role.segment : null
  if (!record(segment) || typeof segment.attribute !== "string" || typeof segment.member !== "string") return false
  const objectOf = (node: Node | null, seen = new Set<Node>()): TSESTree.ObjectExpression | null => {
    if (!node || seen.has(node)) return null
    const value = unwrap(node)
    if (value.type === "ObjectExpression") return value
    if (value.type !== "Identifier") return null
    const definition = variableOf(drawing.context, value)?.defs[0]
    return definition?.type === "Variable" && definition.parent.kind === "const" ? objectOf(definition.node.init, new Set(seen).add(node)) : null
  }
  return (
    pagesOf(drawing)?.every(
      (page) =>
        objectOf(attributeValue(attribute(page.openingElement, segment.attribute as string)))?.properties.some(
          (property) =>
            property.type === "Property" && !property.computed && property.key.type === "Identifier" && property.key.name === segment.member
        ) === true
    ) === true
  )
}

/** Shared with R325: one connected entry, its actual sibling Base, its own Page. */
export const connectedPageDrawing = (context: AnyContext, opening: TSESTree.JSXOpeningElement): Owner | null => {
  const owner = resolvedOwner(importedHeader(context, opening))
  if (!owner) return null
  const classification = hfsOf(context).classify(owner.context.filename)
  if (classification.slot !== "fe.components" || classification.kind !== "blocks" || classification.role !== "entry") return null
  const drawing = ownDrawing(owner) ?? owner
  return pagesOf(drawing) ? drawing : null
}

/** An actual reference to the selected function parameter's children. */
const parameterChildren = (owner: Owner, node: Node | null): boolean => parameterMember({ owner, field: "children" }, node)

/** The connected half passes children once to its twin; the twin draws it in Page's body. */
const carriesChildren = (entry: Owner, drawing: Owner): boolean => {
  const entryRoots = roots(entry)
  const pages = pagesOf(drawing)
  if (!entryRoots || !pages) return false
  const directContent = (owner: Owner, element: TSESTree.JSXElement): boolean => {
    const attributes = element.openingElement.attributes
    if (attributes.some((item) => item.type === "JSXSpreadAttribute")) return false
    const direct =
      element.children.filter((child) => child.type === "JSXExpressionContainer" && parameterChildren(owner, child.expression)).length +
      attributes.filter((item) => item.type === "JSXAttribute" && item.name.name === "children" && parameterChildren(owner, attributeValue(item)))
        .length
    let all = 0
    walk(owner.context.sourceCode, element, (node) => {
      if (parameterChildren(owner, node)) all += 1
    })
    return direct === 1 && all === 1
  }
  return (
    entryRoots.every((element) => directContent(entry, element)) &&
    pages.every((page) => preservesPageBody(drawing, page, { resolve: resolvedOwner, returned }))
  )
}

/** Feature composition may use its own pure half, never a second feature/block relay. */
const featureRoots = (owner: Owner): { readonly owner: Owner; readonly roots: readonly TSESTree.JSXElement[] } | null => {
  const entry = resolvedOwner(owner)
  if (!entry) return null
  const drawing = ownDrawing(entry) ?? entry
  const elements = roots(drawing)
  return elements ? { owner: drawing, roots: elements } : null
}

/** Route files are selected by the HFS route role and imported selected export. */
const mountedFeatures = (context: AnyContext, directory: string): Owner[] => {
  if (!fs.existsSync(directory)) return []
  const features: Owner[] = []
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name)
    if (item.isDirectory()) {
      features.push(...mountedFeatures(context, filename))
      continue
    }
    if (!item.isFile()) continue
    const classification = hfsOf(context).classify(filename)
    if (classification.status !== "owned" || classification.slot !== "fe.route" || !["page", "layout"].includes(classification.role ?? "")) continue
    const route = parsedSource(context, filename)
    const owner = resolvedOwner(headerExport(route, "default"))
    if (!owner) continue
    const elements = roots(owner)
    if (!elements) continue
    for (const element of elements) {
      const feature = resolvedOwner(importedHeader(route, element.openingElement))
      if (!feature) continue
      const found = hfsOf(context).classify(feature.context.filename)
      const expected = classification.role === "layout" ? "layouts" : "pages"
      if (found.status === "owned" && found.slot === "fe.feature" && found.kind === expected && found.role === "entry") features.push(feature)
    }
  }
  return features
}

/**
 * Grant only the actual input type member of a proven mounted root and its twin.
 * A nearby unrelated type declaration never inherits the proof.
 */
const inputMembers = (owner: Owner): readonly TSESTree.TypeElement[] => {
  if (!isFn(owner.value)) return []
  const parameter = owner.value.params[0]
  const annotation = parameter && "typeAnnotation" in parameter ? parameter.typeAnnotation?.typeAnnotation : null
  const seen = new Set<Node>()
  const read = (node: Node | null | undefined): readonly TSESTree.TypeElement[] => {
    if (!node || seen.has(node)) return []
    seen.add(node)
    if (node.type === "TSTypeLiteral") return node.members
    if (node.type === "TSInterfaceBody") return node.body
    if (node.type === "TSIntersectionType") return node.types.flatMap(read)
    if (node.type !== "TSTypeReference" || node.typeName.type !== "Identifier") return []
    const definition = variableOf(owner.context, node.typeName)?.defs[0]
    if (definition?.type !== "Type") return []
    if (definition.node.type === "TSTypeAliasDeclaration") return read(definition.node.typeAnnotation)
    if (definition.node.type === "TSInterfaceDeclaration") return read(definition.node.body)
    return []
  }
  return read(annotation)
}

/** Each source-code lifetime gets one mounted-owner proof; no process-wide stale app cache. */
const childrenProofs = new WeakMap<AnyContext["sourceCode"], ReadonlySet<number>>()

export const rootPageChildren = (context: AnyContext, member: TSESTree.TypeElement): boolean => {
  let proven = childrenProofs.get(context.sourceCode)
  if (!proven) {
    const result = new Set<number>()
    childrenProofs.set(context.sourceCode, result)
    const found = hfsOf(context).classify(context.filename)
    if (found.status !== "owned" || found.slot !== "fe.components" || found.kind !== "blocks" || !["entry", "drawing"].includes(found.role ?? ""))
      return false
    if (!fs.existsSync(context.filename)) return false
    const current = parsedSource(context, context.filename)
    if (current.sourceCode.text !== context.sourceCode.text) return false
    const entryFile = found.role === "entry" ? context.filename : path.join(path.dirname(context.filename), "index.tsx")
    if (!fs.existsSync(entryFile)) return false
    const entryContext = found.role === "entry" ? current : parsedSource(context, entryFile)
    const entries = entryContext.program.body
      .filter((statement): statement is TSESTree.ExportNamedDeclaration => statement.type === "ExportNamedDeclaration")
      .flatMap((statement) => {
        const declaration = statement.declaration
        const names =
          declaration?.type === "VariableDeclaration"
            ? declaration.declarations.flatMap((item) => (item.id.type === "Identifier" ? [item.id.name] : []))
            : declaration?.type === "FunctionDeclaration" && declaration.id
              ? [declaration.id.name]
              : statement.specifiers.map((specifier) =>
                  specifier.exported.type === "Identifier" ? specifier.exported.name : specifier.exported.value
                )
        return names.map((name) => resolvedOwner(headerExport(entryContext, name)))
      })
      .filter((owner): owner is Owner => owner !== null)
    for (const entry of entries) {
      const drawing = ownDrawing(entry)
      if (!drawing || !carriesChildren(entry, drawing)) continue
      const app = found.bindings?.app
      const appSlot = hfsOf(context).slot("fe.app.next")
      if (!app || !appSlot) continue
      const prefix = appSlot.path.split("/{")[0]?.replace("<app>", app)
      if (!prefix) continue
      const mounted = mountedFeatures(context, path.join(hfsOf(context).repoRoot, prefix, "src/app"))
      let selected = false
      const composed = mounted.every((feature) => {
        const composition = featureRoots(feature)
        if (!composition) {
          const target = ownDrawing(feature) ?? feature
          let usesEntry = false
          walk(target.context.sourceCode, target.value, (node) => {
            if (node.type !== "JSXElement") return
            const block = resolvedOwner(importedHeader(target.context, node.openingElement))
            if (block && sameOwner(block, entry)) usesEntry = true
          })
          return !usesEntry
        }
        let usesEntry = false
        let nestedEntry = false
        for (const root of composition.roots)
          walk(composition.owner.context.sourceCode, root, (node) => {
            if (node.type !== "JSXElement") return
            const block = resolvedOwner(importedHeader(composition.owner.context, node.openingElement))
            if (!block || !sameOwner(block, entry)) return
            usesEntry = true
            if (node !== root) nestedEntry = true
          })
        if (!usesEntry) return true
        selected = true
        if (nestedEntry) return false
        const valid = composition.roots.every((root) => {
          const page = connectedPageDrawing(composition.owner.context, root.openingElement)
          const ownsPage = isPageRenderer(composition.owner.context, root.openingElement) || page !== null
          const layout = hfsOf(context).classify(feature.context.filename).kind === "layouts"
          return ownsPage && (!layout || (page !== null && segmentDrawing(page)))
        })
        return valid
      })
      if (!composed || !selected) continue
      const local = found.role === "entry" ? entry : drawing
      if (path.resolve(local.context.filename) !== path.resolve(context.filename)) continue
      for (const input of inputMembers(local))
        if (input.type === "TSPropertySignature" && input.key.type === "Identifier" && input.key.name === "children") result.add(input.range[0])
    }
    proven = result
  }
  return proven.has(member.range[0])
}
