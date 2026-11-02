/**
 * The ESLint rule of the grammar's own components (`eslint.config.mjs`), the TypeScript half of
 * `scripts/lint/stylelint-plugin.mts`. A component names a role and the stylesheet gives it a value, so a component
 * holds no hex colour, colour function, length, utility class or numeric style value (`starci-grammar/no-literal-look`).
 */
import type { Rule } from "eslint"

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/
const COLOR_FUNCTION = /(?:^|[^\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/
const LENGTH = /(?:^|[^\w.#[-])-?(?!0+(?:\.0+)?(?:px|rem|em))(?:\d+\.?\d*|\.\d+)(?:px|rem|em)(?![\w-])/
const UTILITY =
    /(?:^|\s)(?:text-(?:xs|sm|base|lg|[2-9]?xl)|font-(?:thin|light|normal|medium|semibold|bold|extrabold|black)|leading-[\w.]+|tracking-[\w.]+|rounded-\w+|shadow-\w+|opacity-\d+|duration-\d+|[pm][trblxy]?-\d+|gap-\d+|space-[xy]-\d+|(?:bg|text|border)-(?:white|black|[a-z]+-\d+)|[wh]-\[)(?=\s|$)/
const STYLE_KEY =
    /^(?:width|height|minWidth|maxWidth|minHeight|maxHeight|top|left|right|bottom|gap|padding\w*|margin\w*|fontSize|fontWeight|lineHeight|letterSpacing|borderRadius|opacity|transitionDuration|animationDuration)$/

const FALLBACK = /var\(--[\w-]+\s*,\s*(?!var\()/

const CHECKS: readonly { readonly test: RegExp; readonly say: string }[] = [
    { test: HEX, say: "A hex colour is a literal. Read a HeroUI token." },
    { test: COLOR_FUNCTION, say: "A colour function is a literal. Read a HeroUI token, or mix tokens in CSS." },
    { test: LENGTH, say: "A length is a literal. Name a role in CSS (a ramp of src/common/ramps.css, or the spacing scale)." },
    { test: FALLBACK, say: "A var() fallback is a literal. Define the token once on the root (src/common/ramps.css) and read it bare." },
    { test: UTILITY, say: "A utility class decides the look in a component. Set a data attribute; the stylesheet reads the ramps." },
]

export const noLiteralLook: Rule.RuleModule = {
    meta: { type: "problem", schema: [], docs: { description: "A component holds no hardcoded colour, length, utility class or numeric style value." } },
    create(context) {
        const judge = (node: Rule.Node, text: string): void => {
            for (const check of CHECKS) if (check.test.test(text)) context.report({ node, message: check.say })
        }
        return {
            Literal(node) {
                if (typeof node.value === "string") judge(node, node.value)
            },
            TemplateElement(node) {
                judge(node, node.value.cooked ?? node.value.raw)
            },
            "JSXAttribute[name.name=\"style\"] Property"(node: Rule.Node) {
                if (node.type !== "Property") return
                const key = node.key.type === "Identifier" ? node.key.name : node.key.type === "Literal" ? String(node.key.value) : ""
                if (!STYLE_KEY.test(key) || node.value.type !== "Literal" || typeof node.value.value !== "number" || node.value.value === 0 || node.value.value === 1) return
                context.report({ node, message: "A style value is a literal. Set a data attribute or a custom property; the stylesheet reads the ramps." })
            },
        }
    },
}

/** An ESTree-shaped node, read without the TypeScript-ESTree types, which this package does not install. */
type Ast = { readonly type: string; readonly [key: string]: unknown }
const isAst = (value: unknown): value is Ast => typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"
const nameOf = (value: unknown): string | undefined => (isAst(value) && value.type === "Identifier" && typeof value.name === "string" ? value.name : undefined)
const isPosition = (value: unknown): value is { readonly line: number; readonly column: number } =>
    typeof value === "object" && value !== null && "line" in value && typeof value.line === "number" && "column" in value && typeof value.column === "number"
const isRange = (value: unknown): value is readonly [number, number] => Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number"

const COMPONENT_FILE = /[\\/]src[\\/]core[\\/](leaf|branch|composite|frame)[\\/]([A-Za-z0-9]+)[\\/]index\.tsx$/
/** The one component whose content is inline (a sentence holds Code, Link and Kbd); the lint rule `text-inline-only` refuses a block in it. */
const INLINE_CONTENT = new Set(["Text"])
/** The one hole, with a stated reason (R341). */
const CLASS_NAME_HOLE = new Set(["Freestyle"])
/** Types of a part the component receives, not props it takes: an icon source's own props. */
const RECEIVED = new Set(["ComponentType", "ElementType", "FunctionComponent"])
const RECEIVED_SHAPE = new Set(["TSFunctionType", "TSConstructorType"])
const PASSTHROUGH = /Component(?:Props|PropsWithoutRef)<|HTMLAttributes</

/** Every node under `node`, `node` first. */
const subtree = (node: Ast, found: Ast[] = []): Ast[] => {
    found.push(node)
    if (RECEIVED_SHAPE.has(node.type) || (node.type === "TSTypeReference" && RECEIVED.has(nameOf(node.typeName) ?? ""))) return found
    for (const [key, value] of Object.entries(node)) {
        if (key === "parent" || key === "loc" || key === "range") continue
        if (Array.isArray(value)) value.forEach((item) => { if (isAst(item)) subtree(item, found) })
        else if (isAst(value)) subtree(value, found)
    }
    return found
}

/**
 * The tier binding of a component's props (the ladder leaf, branch, composite, frame; `NoChildren` and `LabelChild` of `src/core/tier.ts`).
 * A frame owns a region and takes `children`. A leaf takes at most its text label (`children: string` or `LabelChild`). A branch or a
 * composite takes none (`NoChildren`), so nested JSX under it fails to compile for every caller. No component takes `className`, bar
 * `Freestyle`; a props type that passes an element's attributes through omits it. The rule reads the `<Name>Props` of the component
 * folder and the local types it names.
 */
export const tierProps: Rule.RuleModule = {
    meta: { type: "problem", schema: [], docs: { description: "A component's props follow its tier: children and className." } },
    create(context) {
        const match = COMPONENT_FILE.exec(context.filename)
        if (match === null) return {}
        const tier = match[1]
        const name = match[2] ?? ""
        const declarations = new Map<string, Ast>()
        const report = (node: Ast, message: string): void => {
            const loc: unknown = node.loc
            const start = typeof loc === "object" && loc !== null && "start" in loc ? loc.start : undefined
            const end = typeof loc === "object" && loc !== null && "end" in loc ? loc.end : undefined
            if (isPosition(start) && isPosition(end)) context.report({ loc: { start, end }, message })
        }
        const textOf = (node: Ast): string => (isRange(node.range) ? context.sourceCode.text.slice(node.range[0], node.range[1]) : "")
        return {
            Program(program) {
                for (const statement of program.body) {
                    const inner: unknown = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement
                    if (isAst(inner) && (inner.type === "TSTypeAliasDeclaration" || inner.type === "TSInterfaceDeclaration")) {
                        const id = nameOf(inner.id)
                        if (id !== undefined) declarations.set(id, inner)
                    }
                }
                const root = declarations.get(`${name}Props`)
                if (root === undefined) return
                const reachable = new Map<string, Ast>([[`${name}Props`, root]])
                const queue = [root]
                for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
                    for (const node of subtree(next)) {
                        const referenced = node.type === "TSTypeReference" ? nameOf(node.typeName) : undefined
                        const target = referenced === undefined ? undefined : declarations.get(referenced)
                        if (referenced !== undefined && target !== undefined && !reachable.has(referenced)) {
                            reachable.set(referenced, target)
                            queue.push(target)
                        }
                    }
                }
                const text = [...reachable.values()].map(textOf).join("\n")
                for (const declaration of reachable.values()) {
                    for (const node of subtree(declaration)) {
                        if (node.type !== "TSPropertySignature") continue
                        const key = nameOf(node.key)
                        if (key === "className" && !CLASS_NAME_HOLE.has(name)) report(node, `${name} takes no className: a role prop or the structure decides the look.`)
                        if (key !== "children" || tier === "frame" || INLINE_CONTENT.has(name)) continue
                        const annotation = isAst(node.typeAnnotation) && isAst(node.typeAnnotation.typeAnnotation) ? node.typeAnnotation.typeAnnotation.type : ""
                        const allowed = tier === "leaf" ? ["TSStringKeyword", "TSNeverKeyword"] : ["TSNeverKeyword"]
                        if (!allowed.includes(annotation)) report(node, tier === "leaf" ? "A leaf takes its text label as `children: string`, never a node." : `A ${tier} takes no children: name the slot for its role.`)
                    }
                }
                if (PASSTHROUGH.test(text) && !text.includes('"className"') && !CLASS_NAME_HOLE.has(name)) report(root, `${name}Props passes an element's attributes through: omit "className".`)
                if (tier === "frame" || INLINE_CONTENT.has(name)) return
                const labelled = tier === "leaf" && /children[?]?: string/.test(text)
                if (!text.includes("NoChildren") && !text.includes("LabelChild") && !labelled) {
                    report(root, `${name}Props must include ${tier === "leaf" ? "NoChildren, LabelChild or children: string" : "NoChildren"} (src/core/tier.ts), so nested JSX does not compile.`)
                }
            },
        }
    },
}

/** The props a tier may own, counted over `<Name>Props` and the local types it names, and the slots (`ReactNode` props) any of them may have. */
const PROP_BUDGET: Readonly<Record<string, number>> = { leaf: 8, branch: 12, composite: 12, frame: 10 }
const SLOT_BUDGET = 3

/** The `<Name>Props` declaration of a file and every local type it reaches, or null when the file declares none. */
const reachableProps = (program: Ast, name: string): { readonly root: Ast; readonly reachable: readonly Ast[] } | null => {
    const declarations = new Map<string, Ast>()
    const body: unknown = program.body
    for (const statement of Array.isArray(body) ? body : []) {
        if (!isAst(statement)) continue
        const inner: unknown = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement
        if (isAst(inner) && (inner.type === "TSTypeAliasDeclaration" || inner.type === "TSInterfaceDeclaration")) {
            const id = nameOf(inner.id)
            if (id !== undefined) declarations.set(id, inner)
        }
    }
    const root = declarations.get(`${name}Props`)
    if (root === undefined) return null
    const reachable = new Map<string, Ast>([[`${name}Props`, root]])
    const queue = [root]
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        for (const node of subtree(next)) {
            const referenced = node.type === "TSTypeReference" ? nameOf(node.typeName) : undefined
            const target = referenced === undefined ? undefined : declarations.get(referenced)
            if (referenced !== undefined && target !== undefined && !reachable.has(referenced)) {
                reachable.set(referenced, target)
                queue.push(target)
            }
        }
    }
    return { root, reachable: [...reachable.values()] }
}

const reportAt = (context: Rule.RuleContext, node: Ast, message: string): void => {
    const loc: unknown = node.loc
    const start = typeof loc === "object" && loc !== null && "start" in loc ? loc.start : undefined
    const end = typeof loc === "object" && loc !== null && "end" in loc ? loc.end : undefined
    if (isPosition(start) && isPosition(end)) context.report({ loc: { start, end }, message })
}

/** A component's props stay inside its tier's budget: a count of props, and at most three `ReactNode` slots. */
export const propBudget: Rule.RuleModule = {
    meta: { type: "problem", schema: [], docs: { description: "A component's own props and its ReactNode slots stay inside the tier's budget." } },
    create(context) {
        const match = COMPONENT_FILE.exec(context.filename)
        if (match === null) return {}
        const tier = match[1] ?? ""
        const name = match[2] ?? ""
        const budget = PROP_BUDGET[tier]
        return {
            Program(program) {
                if (!isAst(program)) return
                const found = reachableProps(program, name)
                if (found === null || budget === undefined) return
                const props = new Set<string>()
                let slots = 0
                for (const declaration of found.reachable) {
                    for (const node of subtree(declaration)) {
                        if (node.type !== "TSPropertySignature") continue
                        const key = nameOf(node.key)
                        if (key === undefined) continue
                        props.add(key)
                        const annotation = isAst(node.typeAnnotation) ? context.sourceCode.text.slice(...(isRange(node.typeAnnotation.range) ? node.typeAnnotation.range : [0, 0])) : ""
                        if (/ReactNode/.test(annotation) && key !== "children") slots += 1
                    }
                }
                if (props.size > budget) reportAt(context, found.root, `${name}Props has ${String(props.size)} props, over the ${tier} budget of ${String(budget)}: split the role, or move a group of props into data one prop carries.`)
                if (slots > SLOT_BUDGET) reportAt(context, found.root, `${name}Props has ${String(slots)} ReactNode slots, over the budget of ${String(SLOT_BUDGET)}: a component with more slots is a frame or two components.`)
            },
        }
    },
}

const STATE_HOOKS = new Set(["useState", "useReducer", "useEffect", "useLayoutEffect", "useInsertionEffect"])

/** A leaf and a composite hold no state and no effect: what changes over time belongs to a branch, which owns the behaviour. */
export const tierState: Rule.RuleModule = {
    meta: { type: "problem", schema: [], docs: { description: "A leaf or a composite holds no useState, useReducer or effect." } },
    create(context) {
        const match = COMPONENT_FILE.exec(context.filename)
        if (match === null || (match[1] !== "leaf" && match[1] !== "composite")) return {}
        return {
            CallExpression(node) {
                const callee: unknown = node.callee
                const name = nameOf(callee)
                if (name !== undefined && STATE_HOOKS.has(name)) reportAt(context, node as unknown as Ast, `A ${match[1] ?? "leaf"} holds no state or effect (${name}): the behaviour belongs to a branch, and a leaf or composite draws what it is given.`)
            },
        }
    },
}

export default { rules: { "no-literal-look": noLiteralLook, "tier-props": tierProps, "prop-budget": propBudget, "tier-state": tierState } }
