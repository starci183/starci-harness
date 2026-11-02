/** Finite content provenance inside a root Page: static grammar anatomy, local pure drawing, canonical region status. */
import type { TSESTree } from "@typescript-eslint/utils"
import { grammarContractFor } from "#runtime/scripts/lib/grammar-lint.mjs"
import { canonicalStatusOwnerBinding } from "#runtime/scripts/hfs/architecture/canon-jsx-clones.mjs"
import { attribute, attributeValue, stringOf, walk } from "./ast.ts"
import { isFn, unwrap, variableOf } from "./bindings.ts"
import { hfsOf } from "./hfs.ts"
import { importedHeader, jsxImport, type Owner } from "./owner-source.ts"
import type { Node } from "./rule.ts"

export interface BodyReaders {
  readonly resolve: (owner: Owner | null) => Owner | null
  readonly returned: (owner: Owner) => readonly Node[] | null
}
interface Content {
  readonly owner: Owner
  readonly field: string
}
const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value)

/** A field of the actual selected function parameter, never a matching identifier spelling. */
export const parameterMember = (content: Content, node: Node | null): boolean => {
  const { owner, field } = content
  if (
    !isFn(owner.value) ||
    !node ||
    node.type !== "MemberExpression" ||
    node.computed ||
    node.property.type !== "Identifier" ||
    node.property.name !== field ||
    node.object.type !== "Identifier"
  )
    return false
  const parameter = owner.value.params[0]
  return (
    parameter?.type === "Identifier" &&
    variableOf(owner.context, node.object)?.defs.some((definition) => definition.type === "Parameter" && definition.name === parameter) === true
  )
}

const references = (content: Content, node: Node): number => {
  let count = 0
  walk(content.owner.context.sourceCode, node, (child) => {
    if (parameterMember(content, child)) count += 1
  })
  return count
}

const bodyContainer = (owner: Owner, opening: TSESTree.JSXOpeningElement, contexts: ReadonlySet<string>): ReadonlySet<string> | null => {
  const family = hfsOf(owner.context).grammar
  if (!family) return null
  const roles = grammarContractFor(family).semanticRoles
  const page = record(roles) ? roles.page : null
  if (!record(page) || !Array.isArray(page.bodyContainers) || !Array.isArray(page.entries)) return null
  const imported = jsxImport(owner.context, opening)
  if (!imported || !page.bodyContainers.includes(imported.exported) || !page.entries.some((entry) => typeof entry === "string" && entry.replace("<family>", family) === imported.source)) return null
  if (page.bodyContainerConstraints !== undefined && !record(page.bodyContainerConstraints)) return null
  const constraint = record(page.bodyContainerConstraints) ? page.bodyContainerConstraints[imported.exported] : undefined
  if (constraint === undefined) return contexts
  if (!record(constraint) || Object.keys(constraint).some((key) => !["requiresContext", "providesContext", "absentProps", "literalProps"].includes(key))) return null
  if (constraint.requiresContext !== undefined && (typeof constraint.requiresContext !== "string" || !contexts.has(constraint.requiresContext))) return null
  if (constraint.absentProps !== undefined) {
    const absent = constraint.absentProps
    if (!Array.isArray(absent) || !absent.every((name) => typeof name === "string")) return null
    if (opening.attributes.some((item) => item.type === "JSXAttribute" && item.name.type === "JSXIdentifier" && absent.includes(item.name.name))) return null
  }
  if (constraint.literalProps !== undefined) {
    if (!record(constraint.literalProps)) return null
    for (const [name, choices] of Object.entries(constraint.literalProps)) {
      if (!Array.isArray(choices) || !choices.every((choice) => typeof choice === "string")) return null
      for (const item of opening.attributes) {
        if (item.type !== "JSXAttribute" || item.name.type !== "JSXIdentifier" || item.name.name !== name) continue
        const value = attributeValue(item)
        const literal = value && stringOf(unwrap(value))
        if (literal === null || !choices.includes(literal)) return null
      }
    }
  }
  if (constraint.providesContext === undefined) return contexts
  return typeof constraint.providesContext === "string" ? new Set(contexts).add(constraint.providesContext) : null
}

/** The exactly returned fragment/expression, with no unused or duplicated call hidden beside it. */
const returnedCall = (node: Node): TSESTree.CallExpression | null => {
  const value = unwrap(node)
  if (value.type === "CallExpression") return value
  if (value.type !== "JSXFragment") return null
  const children = value.children.filter((child) => child.type !== "JSXText" || child.value.trim() !== "")
  const expression = children.length === 1 && children[0]?.type === "JSXExpressionContainer" ? children[0].expression : null
  return expression?.type === "CallExpression" ? expression : null
}

/** Prove the selected SlotView implementation really calls render on loading/ready, and never on refusal. */
const canonicalRegion = (owner: Owner, readers: BodyReaders): boolean => {
  const found = hfsOf(owner.context).classify(owner.context.filename)
  if (found.status !== "owned" || found.slot !== "fe.components" || found.kind !== "composites" || found.role !== "entry") return false
  if (!isFn(owner.value) || owner.value.body.type !== "BlockStatement") return false
  const body = owner.value.body.body
  const active = body.filter((statement) => statement.type !== "VariableDeclaration")
  if (active.length !== 5 || active.slice(0, 4).some((statement) => statement.type !== "IfStatement" || statement.alternate !== null)) return false
  const states = ["isLoading", "isForbidden", "isError", "isEmpty"]
  let slot: TSESTree.Identifier | null = null
  for (const [index, statement] of active.slice(0, 4).entries()) {
    if (
      statement.type !== "IfStatement" ||
      statement.test.type !== "BinaryExpression" ||
      statement.test.operator !== "in" ||
      statement.test.left.type !== "Literal" ||
      statement.test.left.value !== states[index] ||
      statement.test.right.type !== "Identifier"
    )
      return false
    if (slot && variableOf(owner.context, slot) !== variableOf(owner.context, statement.test.right)) return false
    slot = statement.test.right
  }
  if (!slot) return false
  const slotBinding = variableOf(owner.context, slot)
  const definition = slotBinding?.defs[0]
  const parameter = owner.value.params[0]
  if (
    definition?.type !== "Variable" ||
    definition.parent.kind !== "const" ||
    definition.node.id.type !== "ObjectPattern" ||
    definition.node.init?.type !== "Identifier" ||
    parameter?.type !== "Identifier" ||
    variableOf(owner.context, definition.node.init)?.defs.some((item) => item.type === "Parameter" && item.name === parameter) !== true
  )
    return false
  const slotProperty = definition.node.id.properties.find(
    (property) => property.type === "Property" && property.key.type === "Identifier" && property.key.name === "slot"
  )
  if (slotProperty?.type !== "Property" || slotProperty.value.type !== "Identifier" || variableOf(owner.context, slotProperty.value) !== slotBinding)
    return false
  const loading = active[0]
  const ready = active[4]
  if (
    loading?.type !== "IfStatement" ||
    loading.consequent.type !== "ReturnStatement" ||
    !loading.consequent.argument ||
    ready?.type !== "ReturnStatement" ||
    !ready.argument
  )
    return false
  const waitingCall = returnedCall(loading.consequent.argument)
  const readyCall = returnedCall(ready.argument)
  if (!waitingCall || !readyCall) return false
  const renderField: Content = { owner, field: "render" }
  const validCall = (call: TSESTree.CallExpression, waiting: boolean): boolean => {
    if (
      !parameterMember(renderField, call.callee) ||
      call.arguments.length !== 2 ||
      call.arguments[1]?.type !== "Literal" ||
      call.arguments[1].value !== waiting
    )
      return false
    const data = call.arguments[0]
    if (!data) return false
    if (waiting) return parameterMember({ owner, field: "placeholder" }, data)
    return (
      data.type === "MemberExpression" &&
      !data.computed &&
      data.property.type === "Identifier" &&
      data.property.name === "items" &&
      data.object.type === "Identifier" &&
      variableOf(owner.context, data.object) === slotBinding
    )
  }
  if (!validCall(waitingCall, true) || !validCall(readyCall, false)) return false
  let calls = 0
  walk(owner.context.sourceCode, owner.value.body, (node) => {
    if (node.type === "CallExpression" && parameterMember(renderField, node.callee)) calls += 1
  })
  const live = readers.returned(owner)
  return calls === 2 && live !== null && live.includes(loading.consequent.argument) && live.includes(ready.argument)
}

/** A local pure helper is followed by its binding; imported helpers must be actual lower owners. */
const helperOwner = (content: Content, opening: TSESTree.JSXOpeningElement, readers: BodyReaders): Owner | null => {
  if (opening.name.type === "JSXIdentifier") {
    const variable = variableOf(content.owner.context, opening.name)
    const definition = variable?.defs[0]
    const value =
      definition?.type === "Variable" && definition.parent.kind === "const"
        ? definition.node.init
        : definition?.type === "FunctionName"
          ? definition.node
          : null
    if (value) return readers.resolve({ context: content.owner.context, value })
  }
  const imported = readers.resolve(importedHeader(content.owner.context, opening))
  if (!imported) return null
  const found = hfsOf(content.owner.context).classify(imported.context.filename)
  return found.status === "owned" && found.slot === "fe.components" && ["frames", "composites", "branches", "leaves"].includes(found.kind ?? "")
    ? imported
    : null
}

/** A finite path must consume the content exactly once; unknown JSX/calls/branches fail closed. */
const rendered = (content: Content, node: Node, readers: BodyReaders, seen: ReadonlySet<Node>, contexts: ReadonlySet<string>): boolean => {
  if (parameterMember(content, node)) return true
  if (node.type === "JSXExpressionContainer") return rendered(content, node.expression, readers, seen, contexts)
  if (node.type === "JSXFragment") return renderedChildren(content, node.children, readers, seen, contexts)
  if (node.type !== "JSXElement" || node.openingElement.attributes.some((item) => item.type === "JSXSpreadAttribute")) return false
  const imported = jsxImport(content.owner.context, node.openingElement)
  if (imported && canonicalStatusOwnerBinding(imported.source, imported.exported)) {
    const status = readers.resolve(importedHeader(content.owner.context, node.openingElement))
    const callback = attributeValue(attribute(node.openingElement, "render"))
    if (!status || !canonicalRegion(status, readers) || !callback || !isFn(callback)) return false
    if (references(content, node) !== 1 || references(content, callback) !== 1) return false
    const values = readers.returned({ ...content.owner, value: callback })
    return values !== null && values.length > 0 && values.every((value) => parameterMember(content, value))
  }
  const containerContexts = bodyContainer(content.owner, node.openingElement, contexts)
  if (containerContexts !== null) {
    if (node.openingElement.attributes.some((item) => references(content, item) > 0)) return false
    return renderedChildren(content, node.children, readers, seen, containerContexts)
  }
  const helper = helperOwner(content, node.openingElement, readers)
  if (!helper || seen.has(helper.value)) return false
  const carrying = node.openingElement.attributes.filter((item) => references(content, item) > 0)
  if (carrying.length !== 1 || references(content, node) !== 1) return false
  const input = carrying[0]
  if (input?.type !== "JSXAttribute" || input.name.type !== "JSXIdentifier" || !parameterMember(content, attributeValue(input))) return false
  const target: Content = { owner: helper, field: input.name.name }
  const values = readers.returned(helper)
  return (
    references(target, helper.value) === 1 &&
    values !== null &&
    values.length > 0 &&
    values.every((value) => rendered(target, value, readers, new Set(seen).add(helper.value), contexts))
  )
}

const renderedChildren = (content: Content, children: readonly TSESTree.JSXChild[], readers: BodyReaders, seen: ReadonlySet<Node>, contexts: ReadonlySet<string> = new Set()): boolean => {
  const carrying = children.filter((child) => references(content, child) > 0)
  return carrying.length === 1 && carrying[0] !== undefined && rendered(content, carrying[0], readers, seen, contexts)
}

/** Only Page's body carries owner content; a header/unknown attribute/dead callback cannot stand in for it. */
export const preservesPageBody = (owner: Owner, page: TSESTree.JSXElement, readers: BodyReaders): boolean => {
  const content: Content = { owner, field: "children" }
  if (references(content, page) !== 1 || page.openingElement.attributes.some((item) => references(content, item) > 0)) return false
  return renderedChildren(content, page.children, readers, new Set([owner.value]))
}
