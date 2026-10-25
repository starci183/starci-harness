/**
 * The menu entries a product hands to Grammar's `DropdownMenu`.
 *
 * HeroUI colours a destructive menu item through its `danger` variant, which Grammar exposes as `tone: "danger"`. An entry the app
 * forgets to tone reads like any other command: sign out and delete sit beside "Settings" in the same ink, and the one click that
 * cannot be taken back gets no mark. The decision is the entry's meaning, so it is checked where the entry is written: an entry whose
 * id or label says it signs out, deletes, removes, leaves or revokes carries `tone: "danger"`.
 *
 * The terms are this canon's own list, English and Vietnamese. They are compared as whole words after the text is lower-cased, split
 * at `-`, `_` and camelCase, and stripped of diacritics (the Vietnamese for "sign out" with its tone marks is `dang xuat`), so `signOut`, `sign-out`,
 * `Sign out` and the tone-marked Vietnamese spelling are one term.
 *
 * WHERE IT LOOKS. A menu entry is an object literal in the `entries` attribute of a `DropdownMenu`, or in a declaration typed as
 * `DropdownMenuEntry`, `DropdownMenuItem` or `DropdownMenuSection` (an array of them too), including the `items` of a section and the
 * `submenu` of an item. Anything it cannot see through (a spread, a call) it leaves alone: the rule refuses to guess.
 */

import { stringOf } from "./lib/ast.mjs"
import { resolveLocal } from "./lib/app-shell.mjs"
import { isProductSource } from "./lib/scope.mjs"

/** The English terms of a destructive entry. */
const DESTRUCTIVE_TERMS_EN = Object.freeze([
  "sign out", "log out", "logout", "signout",
  "delete", "remove", "erase", "destroy", "discard", "purge",
  "leave workspace", "leave team", "leave group", "leave organization", "leave project", "leave channel", "leave course", "revoke", "deactivate", "disconnect", "unlink", "unsubscribe", "terminate",
  "close account", "cancel subscription", "cancel plan",
])

/** The Vietnamese terms, written without diacritics (the text is compared after the diacritics are stripped). */
const DESTRUCTIVE_TERMS_VI = Object.freeze([
  "dang xuat", "xoa", "xoa bo", "go bo", "loai bo", "roi khoi", "roi nhom", "thu hoi",
  "vo hieu hoa", "ngat ket noi", "huy dang ky", "huy goi", "cham dut", "dong tai khoan",
])

/** A destructive term as a whole word or phrase of the normalized text. */
const DESTRUCTIVE_PATTERN = new RegExp(String.raw`(?:^|\s)(?:${[...DESTRUCTIVE_TERMS_EN, ...DESTRUCTIVE_TERMS_VI].map((term) => term.replaceAll(" ", String.raw`\s+`)).join("|")})(?=\s|$)`)

/** The text lower-cased, split at separators and camelCase, with diacritics stripped. */
export const normalizeText = (text) =>
  text
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[-_./:]+/g, " ")
    .toLowerCase()
    .replaceAll("\u0111", "d")
    .normalize("NFD")
    .replaceAll(/\p{M}+/gu, "")
    .replaceAll(/\s+/g, " ")
    .trim()

/** True when the id or label text names a destructive command. */
export const isDestructiveText = (text) => DESTRUCTIVE_PATTERN.test(normalizeText(text))

const MENU_TYPES = new Set(["DropdownMenuEntry", "DropdownMenuItem", "DropdownMenuSection"])

/** The value node of the property called `name` in an object literal, or null. */
const propertyValue = (object, name) =>
  object.properties.find((entry) => entry.type === "Property" && !entry.computed && (entry.key.name === name || entry.key.value === name))?.value ?? null

/** The element type of an array type (`T[]`, `readonly T[]`, `ReadonlyArray<T>`), else the type itself. */
const elementTypeOf = (type) => {
  if (type.type === "TSTypeOperator") return elementTypeOf(type.typeAnnotation)
  if (type.type === "TSArrayType") return type.elementType
  const isArrayName = type.type === "TSTypeReference" && type.typeName.type === "Identifier" && (type.typeName.name === "ReadonlyArray" || type.typeName.name === "Array")
  return isArrayName ? (type.typeArguments ?? type.typeParameters)?.params[0] ?? type : type
}

/** True when the type annotation names a menu entry type or an array of one. */
const isMenuType = (annotation) => {
  const type = annotation?.typeAnnotation
  if (!type) return false
  const element = elementTypeOf(type)
  return element.type === "TSTypeReference" && element.typeName.type === "Identifier" && MENU_TYPES.has(element.typeName.name)
}

/** Every possible value must prove danger; an unresolved value cannot mark a destructive action. */
const provesDangerTone = (context, expression, seen = new Set()) => {
  const node = resolveLocal(context, expression)
  if (!node || seen.has(node)) return false
  if (node.type !== "ConditionalExpression") return stringOf(node) === "danger"
  const visited = new Set(seen).add(node)
  return [node.consequent, node.alternate].every((branch) => provesDangerTone(context, branch, visited))
}

/** Report an entry (an object literal), then walk the `items` of a section and the `submenu` of an item. */
function visitEntries(context, node, report) {
  if (!node) return
  if (node.type === "ArrayExpression") {
    for (const element of node.elements) visitEntries(context, element, report)
    return
  }
  if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") {
    visitEntries(context, node.expression, report)
    return
  }
  if (node.type !== "ObjectExpression") return
  const kind = stringOf(propertyValue(node, "kind"))
  if (kind === "section") {
    visitEntries(context, propertyValue(node, "items"), report)
    return
  }
  const text = [stringOf(propertyValue(node, "id")), stringOf(propertyValue(node, "label"))].filter((value) => value !== null)
  const tone = propertyValue(node, "tone")
  const toned = provesDangerTone(context, tone)
  if (!toned && text.some(isDestructiveText)) report(node, text.find(isDestructiveText))
  visitEntries(context, propertyValue(node, "submenu"), report)
}

/** A destructive menu entry carries `tone: "danger"`. */
export const destructiveMenuEntryNeedsDangerTone = {
  meta: {
    type: "problem",
    docs: { description: "A menu entry whose id or label signs out, deletes, removes, leaves or revokes carries `tone: \"danger\"`." },
    schema: [],
    messages: {
      tone:
        "The menu entry `{{text}}` is destructive but has no `tone: \"danger\"`. HeroUI colours the label and glyph of a danger item so the one click that cannot be taken back is marked; without the tone it reads like \"Settings\". Add `tone: \"danger\"` to the entry.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const report = (node, text) => context.report({ node, messageId: "tone", data: { text } })
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "entries") return
        const element = node.parent?.name
        if (element?.type !== "JSXIdentifier" || element.name !== "DropdownMenu") return
        visitEntries(context, node.value?.type === "JSXExpressionContainer" ? node.value.expression : null, report)
      },
      VariableDeclarator(node) {
        if (isMenuType(node.id.typeAnnotation)) visitEntries(context, node.init, report)
      },
    }
  },
}

/** The rules this law contributes to the plugin. */
export const rules = {
  "destructive-menu-entry-needs-danger-tone": destructiveMenuEntryNeedsDangerTone,
}

/** Every rule is an error. */
export const recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error"]))
