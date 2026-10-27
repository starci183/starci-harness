import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, relative } from "node:path"
import type * as ts from "typescript"
import { Refusal } from "../shared/errors.js"
import { entryOf, mergeValues, unitOfComponent } from "./shapes.js"
import type { AppShapes, BaseContract, ShapeMember, ShapeUnion, SlotField, SourcePlace, StaticValue, StoryArgs } from "./shapes.js"

/** The TypeScript compiler module, loaded at run time from the app or the CLI's own install. */
type TypeScript = typeof ts

/** Folders no source of the app lives in. */
const PRUNED = new Set(["node_modules", ".next", "dist", "build", "out", "coverage", "storybook-static", ".turbo", ".git"])

const STORY_FILE = /\.stories\.tsx?$/
const PURE_HALF = /(?:^|\/)component\.tsx$/
const TYPES_MODULE = /(?:^|\/)modules\/types\/(?:.*\/)?[^/]+\.tsx?$/
const SHAPE_SUFFIX = "Shape"
/** The retired name of the union (owner ruling 2026-10-28): a pure half that still exports one is red, never read as an alias. */
const RETIRED_SUFFIX = "State"
const BASE_PROPS_SUFFIX = "BaseProps"
const SLOT_TYPE = "DataSlot"
const LOADING_SLOT = "loadingSlot"
/** How deep a constant may refer to another before the reader gives up on it (a cycle or a long chain). */
const MAX_DEPTH = 8

/**
 * The compiler the scan parses with: the app's own `typescript` (every StarCi front end has one), else the CLI's. No parser
 * of its own and no new dependency: a tree without either cannot be judged, and the verb says so.
 */
export const loadTypeScript = (appRoot: string): TypeScript => {
    const require = createRequire(import.meta.url)
    for (const paths of [[appRoot], undefined]) {
        const found = resolveQuietly(require, paths)
        if (found !== undefined) return require(found) as TypeScript
    }
    throw new Refusal("STORIES_PARSER_MISSING", `no typescript package resolves from ${appRoot} or the CLI; install the app's dependencies first`)
}

const resolveQuietly = (require: NodeJS.Require, paths: string[] | undefined): string | undefined => {
    try {
        return paths === undefined ? require.resolve("typescript") : require.resolve("typescript", { paths })
    } catch {
        return undefined
    }
}

/** Every file under `root`, `/`-separated and relative to it, build output and installs pruned. */
export const sourceFiles = (root: string): string[] => {
    const found: string[] = []
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() && !PRUNED.has(entry.name)) walk(join(dir, entry.name))
            else if (entry.isFile()) found.push(relative(root, join(dir, entry.name)).replaceAll("\\", "/"))
        }
    }
    walk(root)
    return found.sort((a, b) => a.localeCompare(b))
}

/** One parsed file and what reading it needs. */
interface Parsed {
    readonly ts: TypeScript
    readonly file: string
    readonly source: ts.SourceFile
}

const parse = (ts: TypeScript, root: string, file: string): Parsed => ({
    ts,
    file,
    source: ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
})

const placeOf = (parsed: Parsed, node: ts.Node): SourcePlace => ({ file: parsed.file, line: parsed.source.getLineAndCharacterOfPosition(node.getStart(parsed.source)).line + 1 })

const isExported = (ts: TypeScript, node: ts.Node): boolean =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)

/** The type a top-level interface or type alias of the file declares under `name`. */
const localType = (parsed: Parsed, name: string): ts.TypeNode | ts.InterfaceDeclaration | undefined => {
    const { ts } = parsed
    for (const statement of parsed.source.statements) {
        if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name) return statement.type
        if (ts.isInterfaceDeclaration(statement) && statement.name.text === name) return statement
    }
    return undefined
}

/** The initializer of a top-level `const` of the file named `name`. */
const localConstant = (parsed: Parsed, name: string): ts.Expression | undefined => {
    const { ts } = parsed
    for (const statement of parsed.source.statements) {
        if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue
        const declaration = statement.declarationList.declarations.find((entry) => ts.isIdentifier(entry.name) && entry.name.text === name)
        if (declaration !== undefined) return declaration.initializer
    }
    return undefined
}

/** Strips what changes a type but not a value: parentheses, `as`, `satisfies`, `!`. */
const unwrap = (ts: TypeScript, expression: ts.Expression): ts.Expression => {
    let current = expression
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression
    return current
}

const OPAQUE: StaticValue = { kind: "opaque" }

/** A property name the reader can spell: an identifier, a string or a number. */
const propertyName = (ts: TypeScript, name: ts.PropertyName): string | undefined =>
    ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined

/** The keys one property of an object literal sets, in order: a spread's whole object, else its own key and value. */
const propertyEntries = (parsed: Parsed, property: ts.ObjectLiteralElementLike, depth: number): (readonly [string, StaticValue])[] => {
    const { ts } = parsed
    if (ts.isSpreadAssignment(property)) {
        // A spread the reader cannot follow adds nothing it can vouch for; the properties written after it still count.
        const spread = valueOf(parsed, property.expression, depth)
        return spread.kind === "object" ? [...spread.entries] : []
    }
    const name = propertyName(ts, property.name)
    if (name === undefined) return []
    if (ts.isPropertyAssignment(property)) return [[name, valueOf(parsed, property.initializer, depth)]]
    if (ts.isShorthandPropertyAssignment(property)) return [[name, valueOf(parsed, property.name, depth)]]
    return [[name, OPAQUE]]
}

/** The value an object literal builds, with JavaScript's shallow spread: a later key replaces an earlier one whole. */
const objectValue = (parsed: Parsed, node: ts.ObjectLiteralExpression, depth: number): StaticValue => {
    const entries = new Map<string, StaticValue>()
    for (const property of node.properties) for (const [key, value] of propertyEntries(parsed, property, depth)) entries.set(key, value)
    return { kind: "object", entries }
}

/** What an expression evaluates to, read from the source alone; constants of the same file are followed. */
const valueOf = (parsed: Parsed, expression: ts.Expression, depth: number): StaticValue => {
    const { ts } = parsed
    if (depth > MAX_DEPTH) return OPAQUE
    const node = unwrap(ts, expression)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { kind: "string", value: node.text }
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { kind: "boolean", value: node.kind === ts.SyntaxKind.TrueKeyword }
    if (ts.isObjectLiteralExpression(node)) return objectValue(parsed, node, depth + 1)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === LOADING_SLOT) return { kind: "loading" }
    if (ts.isPropertyAccessExpression(node)) return entryOf(valueOf(parsed, node.expression, depth + 1), node.name.text) ?? OPAQUE
    if (ts.isIdentifier(node)) {
        const constant = localConstant(parsed, node.text)
        return constant === undefined ? { kind: "ref", name: node.text } : valueOf(parsed, constant, depth + 1)
    }
    return OPAQUE
}

/** The members of a union type, an inventory's `(typeof X)[number]` read from its `as const` array. */
const unionMembers = (parsed: Parsed, type: ts.TypeNode): { members: ShapeMember[]; unliteral: SourcePlace[] } => {
    const { ts } = parsed
    const parts = ts.isUnionTypeNode(type) ? type.types : [type]
    const members: ShapeMember[] = []
    const unliteral: SourcePlace[] = []
    for (const part of parts) {
        if (ts.isLiteralTypeNode(part) && ts.isStringLiteral(part.literal)) members.push({ name: part.literal.text, ...placeOf(parsed, part) })
        else {
            const inventory = inventoryMembers(parsed, part)
            if (inventory === undefined) unliteral.push(placeOf(parsed, part))
            else members.push(...inventory)
        }
    }
    return { members, unliteral }
}

/** `(typeof X_STATES)[number]` over `const X_STATES = ["a", "b"] as const`: the strings of the array. */
const inventoryMembers = (parsed: Parsed, type: ts.TypeNode): ShapeMember[] | undefined => {
    const { ts } = parsed
    const indexed = ts.isParenthesizedTypeNode(type) ? type.type : type
    if (!ts.isIndexedAccessTypeNode(indexed) || indexed.indexType.kind !== ts.SyntaxKind.NumberKeyword) return undefined
    const query = ts.isParenthesizedTypeNode(indexed.objectType) ? indexed.objectType.type : indexed.objectType
    if (!ts.isTypeQueryNode(query) || !ts.isIdentifier(query.exprName)) return undefined
    const initializer = localConstant(parsed, query.exprName.text)
    const array = initializer === undefined ? undefined : unwrap(ts, initializer)
    if (array === undefined || !ts.isArrayLiteralExpression(array)) return undefined
    const members = array.elements.map((element) => (ts.isStringLiteral(element) ? { name: element.text, ...placeOf(parsed, element) } : undefined))
    return members.every((member) => member !== undefined) ? members : undefined
}

/** The unit an exported alias name ends in `suffix` for, or undefined. */
const unitBefore = (name: string, suffix: string): string | undefined => (name.endsWith(suffix) && name.length > suffix.length ? name.slice(0, -suffix.length) : undefined)

/**
 * Every exported `XShape` alias of a pure half or of modules/types that is a union or a single literal; in a pure half an
 * exported `XState` union is read too, marked renamed, since it is the old name of the same vocabulary.
 */
const shapeUnions = (parsed: Parsed, readsRetired: boolean): ShapeUnion[] => {
    const { ts } = parsed
    return parsed.source.statements.flatMap((statement) => {
        if (!ts.isTypeAliasDeclaration(statement) || !isExported(ts, statement)) return []
        if (ts.isTypeLiteralNode(statement.type) || ts.isMappedTypeNode(statement.type)) return []
        const name = statement.name.text
        const shaped = unitBefore(name, SHAPE_SUFFIX)
        const retired = readsRetired ? unitBefore(name, RETIRED_SUFFIX) : undefined
        const unit = shaped ?? retired
        if (unit === undefined) return []
        return [{ unit, name, renamed: shaped === undefined, ...placeOf(parsed, statement), ...unionMembers(parsed, statement.type) }]
    })
}

/** The members of an object type: a literal, an interface, an intersection or a local name for one. */
const typeMembers = (parsed: Parsed, type: ts.TypeNode | ts.InterfaceDeclaration | undefined, depth: number): readonly ts.TypeElement[] => {
    const { ts } = parsed
    if (type === undefined || depth > MAX_DEPTH) return []
    if (ts.isInterfaceDeclaration(type) || ts.isTypeLiteralNode(type)) return type.members
    if (ts.isIntersectionTypeNode(type)) return type.types.flatMap((part) => typeMembers(parsed, part, depth + 1))
    if (ts.isParenthesizedTypeNode(type)) return typeMembers(parsed, type.type, depth + 1)
    if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
        if (type.typeName.text === "Readonly" && type.typeArguments?.[0] !== undefined) return typeMembers(parsed, type.typeArguments[0], depth + 1)
        return typeMembers(parsed, localType(parsed, type.typeName.text), depth + 1)
    }
    return []
}

/** A member of `props` whose type is `DataSlot<T>`. */
const slotField = (parsed: Parsed, member: ts.TypeElement): SlotField | undefined => {
    const { ts } = parsed
    if (!ts.isPropertySignature(member) || member.type === undefined || !ts.isTypeReferenceNode(member.type)) return undefined
    const typeName = member.type.typeName
    const name = propertyName(ts, member.name)
    return ts.isIdentifier(typeName) && typeName.text === SLOT_TYPE && name !== undefined ? { name, ...placeOf(parsed, member) } : undefined
}

/** Every exported `XBaseProps` of a pure half with the data slots of its `props`. */
const baseContracts = (parsed: Parsed): BaseContract[] => {
    const { ts } = parsed
    return parsed.source.statements.flatMap((statement) => {
        if (!(ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) || !isExported(ts, statement)) return []
        const name = statement.name.text
        if (!name.endsWith(BASE_PROPS_SUFFIX) || name.length === BASE_PROPS_SUFFIX.length) return []
        const contract = ts.isInterfaceDeclaration(statement) ? statement : statement.type
        const props = typeMembers(parsed, contract, 0).find((member) => member.name !== undefined && propertyName(ts, member.name) === "props")
        const propsType = props !== undefined && ts.isPropertySignature(props) ? props.type : undefined
        const slots = typeMembers(parsed, propsType, 0).flatMap((member) => slotField(parsed, member) ?? [])
        return [{ unit: name.slice(0, -BASE_PROPS_SUFFIX.length), ...placeOf(parsed, statement), slots }]
    })
}

/** The CSF meta of a story file: its `export default`, read as a value. */
const metaOf = (parsed: Parsed): StaticValue | undefined => {
    const { ts } = parsed
    const assignment = parsed.source.statements.find((statement): statement is ts.ExportAssignment => ts.isExportAssignment(statement) && statement.isExportEquals !== true)
    return assignment === undefined ? undefined : valueOf(parsed, assignment.expression, 0)
}

/** Every named story of a CSF file, its args merged over the meta's. */
const storyArgs = (parsed: Parsed): StoryArgs[] => {
    const { ts } = parsed
    const meta = metaOf(parsed)
    const component = entryOf(meta, "component")
    const unit = component?.kind === "ref" ? unitOfComponent(component.name) : null
    return parsed.source.statements.flatMap((statement) => {
        if (!ts.isVariableStatement(statement) || !isExported(ts, statement)) return []
        return statement.declarationList.declarations.flatMap((declaration) => {
            if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return []
            const story = valueOf(parsed, declaration.initializer, 0)
            const args = mergeValues(entryOf(meta, "args"), entryOf(story, "args")) ?? { kind: "object", entries: new Map() }
            return [{ story: declaration.name.text, unit, args, ...placeOf(parsed, declaration) }]
        })
    })
}

/** Reads one front-end app: its shape unions, pure-half contracts and stories. */
export const readAppShapes = (ts: TypeScript, root: string): AppShapes => {
    const files = sourceFiles(root)
    const parsed = (file: string): Parsed => parse(ts, root, file)
    const pure = files.filter((file) => PURE_HALF.test(file)).map(parsed)
    const types = files.filter((file) => TYPES_MODULE.test(file) && !file.endsWith(".d.ts") && !STORY_FILE.test(file)).map(parsed)
    return {
        root,
        unions: [...pure.flatMap((file) => shapeUnions(file, true)), ...types.flatMap((file) => shapeUnions(file, false))],
        bases: pure.flatMap(baseContracts),
        stories: files.filter((file) => STORY_FILE.test(file)).map(parsed).flatMap(storyArgs),
    }
}
