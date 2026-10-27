/** Static create-action semantics in a bar's controls and its attached menu declarations. */
import { fileURLToPath } from "node:url"
import { phrasesOf } from "../../runtime/scripts/lib/source-phrases.mjs"
import { escapeRegExp } from "../../runtime/scripts/lib/regex.mjs"
import { propertyKeyText, resolveLocal } from "./app-shell.ts"
import { isNode } from "./types.ts"
import type { ReaderContext, Resolved } from "./types.ts"

const runtimeRoot = fileURLToPath(new URL("../../runtime/", import.meta.url))
const localizedLabels = phrasesOf("appShell.product", runtimeRoot)
if (localizedLabels.length === 0) throw new Error("The FE canon's app-shell create-action phrase catalog is missing: regenerate the runtime bundle.")
const localizedCreate = localizedLabels.map((label) => escapeRegExp(label).replace(/\s+/g, String.raw`\s*`)).join("|")
const CREATE_WORDS = new RegExp(String.raw`\bcreate\b|\bnew\s+(?:item|record|project|task)|${localizedCreate}`, "i")

/** Literal create labels and conventional create handlers are executable static evidence. */
export const isCreateAction = (text: string): boolean => CREATE_WORDS.test(text.normalize("NFC")) || /\bcreate[A-Z]|\bnew[A-Z]|\bonCreate|\bhandleCreate/.test(text)

const ACTION_FIELDS = new Set(["id", "key", "label", "title", "textValue", "onAction", "onPress", "onClick", "action"])

/** Follow static item/section arrays; inspect labels and handlers where a menu action is declared. */
export const menuHasCreate = (context: ReaderContext, expression: Resolved | null | undefined, seen: Set<Resolved> = new Set()): boolean => {
  const node = resolveLocal(context, expression)
  if (!node || seen.has(node)) return false
  seen.add(node)
  if (node.type === "SpreadElement") return menuHasCreate(context, node.argument, seen)
  if (node.type === "ArrayExpression") return node.elements.some((item) => menuHasCreate(context, item, seen))
  if (node.type !== "ObjectExpression") return false
  return node.properties.some((property) => {
    if (property.type === "SpreadElement") return menuHasCreate(context, property.argument, seen)
    const name = propertyKeyText(property.key)
    const value = resolveLocal(context, property.value)
    if (name !== null && ACTION_FIELDS.has(name) && value && isNode(value) && isCreateAction(context.sourceCode.getText(value))) return true
    return menuHasCreate(context, property.value, seen)
  })
}
