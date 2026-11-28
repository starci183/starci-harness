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
/**
 * The components whose content is inline (a sentence holds Code, Link and Kbd): `Text`, whose block content the lint rule
 * `text-inline-only` refuses, and `Quote` (0.64.11), whose `children` are its words when they carry inline code or marks.
 */
const INLINE_CONTENT = new Set(["Text", "Quote"])
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


/**
 * The libraries of the Grammar (DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY). Motion is the CSS transitions its tokens drive, so no
 * animation library is imported anywhere. The graph and markdown libraries are imported ONLY inside Grammar's core ext, each in its
 * own ext (`src/core/ext/graph`, `src/core/ext/markdown`), and declared only as optional peers: an app that never imports an ext
 * entry installs none of them. The same lists are read by `scripts/check-libraries.mts`, which also judges the stories and the
 * manifest; apps never import these libraries themselves (they import `@starci/grammar/core/ext/graph` or `/markdown`).
 */
export const MOTION_LIBRARIES: readonly RegExp[] = [
    /^(?:motion|framer-motion)(?:\/|$)/u,
    /^(?:gsap|animejs|anime\.js|popmotion|react-transition-group|react-spring|@react-spring\/[^/]+|@formkit\/auto-animate|lottie-web|lottie-react|@lottiefiles\/[^/]+|velocity-animate)(?:\/|$)/u,
]

/** Each ext of the core and the libraries only it may import. */
export const EXT_LIBRARIES: Readonly<Record<string, readonly RegExp[]>> = Object.freeze({
    graph: [/^(?:@xyflow\/react|reactflow|react-flow-renderer|@reactflow\/[^/]+)(?:\/|$)/u, /^elkjs(?:\/|$)/u, /^d3-force(?:\/|$)/u],
    markdown: [/^(?:unified|remark-[\w-]+|mdast-util-directive|shiki|@shikijs\/[^/]+|beautiful-mermaid)(?:\/|$)/u],
    recharts: [/^recharts(?:\/|$)/u],
    pdf: [/^pdfjs-dist(?:\/|$)/u],
    dropzone: [/^react-dropzone(?:\/|$)/u],
    chat: [/^@assistant-ui\/[^/]+(?:\/|$)/u],
})

/** The ext a source file belongs to (`src/core/ext/<name>/…`), or null for the core, the families and the stories. */
export const extOf = (file: string): string | null => /(?:^|\/)src\/core\/ext\/([a-z-]+)\//u.exec(file.replaceAll("\\", "/"))?.[1] ?? null

/** Why `file` may not import `specifier`, or null when it may. A file outside every ext imports no ext library. */
export const libraryProblem = (file: string, specifier: string): string | null => {
    if (MOTION_LIBRARIES.some((pattern) => pattern.test(specifier))) return `The Grammar never imports \`${specifier}\`: motion is the CSS transitions its tokens drive.`
    // A `?url` import is a bundler asset (pdfjs's worker file for a Vite build), never the library's code.
    if (/\?url$/u.test(specifier)) return null
    const owner = Object.entries(EXT_LIBRARIES).find(([, patterns]) => patterns.some((pattern) => pattern.test(specifier)))?.[0]
    if (owner === undefined || extOf(file) === owner) return null
    return `\`${specifier}\` is a library of the core's ${owner} ext: only src/core/ext/${owner} imports it (an app draws through @starci/grammar/core/ext/${owner}).`
}

/** True for a module specifier no file of the Grammar outside its ext may import. */
export const isBannedLibrary = (specifier: string): boolean => libraryProblem("src/core/index.ts", specifier) !== null

/** The Grammar imports no animation library, and a graph or markdown library only inside its own ext (static, re-export, dynamic or `require`). */
export const noGraphOrAnimationLibrary: Rule.RuleModule = {
    meta: { type: "problem", schema: [], docs: { description: "No animation library; a graph or markdown library only inside its own core ext." } },
    create(context) {
        const file = context.filename
        const judge = (node: Rule.Node, specifier: unknown): void => {
            if (typeof specifier !== "string") return
            const problem = libraryProblem(file, specifier)
            if (problem !== null) context.report({ node, message: problem })
        }
        return {
            ImportDeclaration(node) { judge(node, node.source.value) },
            ExportAllDeclaration(node) { judge(node, node.source.value) },
            ExportNamedDeclaration(node) { if (node.source) judge(node, node.source.value) },
            ImportExpression(node) { if (node.source.type === "Literal") judge(node, node.source.value) },
            CallExpression(node) {
                const argument = node.arguments[0]
                if (nameOf(node.callee) === "require" && argument !== undefined && argument.type === "Literal") judge(node, argument.value)
            },
        }
    },
}

/**
 * The core's ext boundary (owner 2026-11-22: "ext import core vào để xài vì nó là 1 phần của core"): an ext imports the core (any
 * tier, its tokens and its index) and its own files, never another ext, a family or the package by name; the core, the families and
 * Common never import an ext. Paths are read from the relative specifier, so the rule needs no resolver.
 */
export const extBoundaryProblem = (file: string, specifier: string): string | null => {
    const from = file.replaceAll("\\", "/")
    const at = /^(?:.*\/)?src\/(.*)$/u.exec(from)
    if (at === null) return null
    const fromExt = extOf(from)
    if (/^@starci\/grammar(?:\/|$)/u.test(specifier)) return fromExt === null ? null : `An ext imports the core by path, not \`${specifier}\`: it is part of the core.`
    if (!specifier.startsWith(".")) return null
    const parts = (at[1] ?? "").split("/").slice(0, -1)
    for (const part of specifier.split("/")) {
        if (part === "..") parts.pop()
        else if (part !== ".") parts.push(part)
    }
    const target = parts.join("/")
    const toExt = /^core\/ext\/([a-z-]+)(?:\/|$)/u.exec(target)?.[1] ?? null
    // A story shows an ext as an app would; it is never published (package.json files).
    if (fromExt === null && /(?:^|\/)src\/stories\/|\.stories\.[jt]sx?$/u.test(from)) return null
    if (fromExt === null) return toExt === null ? null : `The core never imports an ext (src/core/ext/${toExt}): an ext is used only in its own situation, and the core entry stays free of its libraries.`
    if (toExt !== null && toExt !== fromExt) return `The ${fromExt} ext imports no other ext (src/core/ext/${toExt}).`
    if (!target.startsWith("core/")) return `The ${fromExt} ext imports only the core (src/core): \`${specifier}\` leaves it.`
    return null
}

export const extBoundary: Rule.RuleModule = {
    meta: { type: "problem", schema: [], docs: { description: "An ext imports only the core and itself; the core never imports an ext." } },
    create(context) {
        const file = context.filename
        const judge = (node: Rule.Node, specifier: unknown): void => {
            if (typeof specifier !== "string") return
            const problem = extBoundaryProblem(file, specifier)
            if (problem !== null) context.report({ node, message: problem })
        }
        return {
            ImportDeclaration(node) { judge(node, node.source.value) },
            ExportAllDeclaration(node) { judge(node, node.source.value) },
            ExportNamedDeclaration(node) { if (node.source) judge(node, node.source.value) },
            ImportExpression(node) { if (node.source.type === "Literal") judge(node, node.source.value) },
        }
    },
}

export default { rules: { "ext-boundary": extBoundary, "no-graph-or-animation-library": noGraphOrAnimationLibrary, "no-literal-look": noLiteralLook, "tier-props": tierProps } }
