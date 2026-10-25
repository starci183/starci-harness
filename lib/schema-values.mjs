import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { normalizePath } from "./path.mjs"

/** Tiers a schema file may live in: the owners of boundary data (R304). */
export const SCHEMA_TIERS = new Set(["domain", "platform", "integrations"])

const ZOD = /^zod(?:\/|$)/
/** A sibling schema module: its exports are schemas too, so a chain may start from them. */
const SIBLING_SCHEMA = /^\.{1,2}\/(?:.*\/)?[^/]+\.schema(?:\.[cm]?[jt]s)?$/

/** The local names the imports of a source file bind whose module specifier matches `specifier`. */
const importedNames = (sourceFile, specifier) => {
    const names = new Set()
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !specifier.test(statement.moduleSpecifier.text)) continue
        const clause = statement.importClause
        if (clause?.name) names.add(clause.name.text)
        const bindings = clause?.namedBindings
        if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text)
        if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) names.add(element.name.text)
    }
    return names
}

/** The identifier a call/member chain starts from (`z.string().max(5)` gives `z`), or null when it starts from anything else. */
const rootOf = (expression) => {
    let current = expression
    for (;;) {
        if (ts.isIdentifier(current)) return current.text
        if (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)
            || ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current) || ts.isAsExpression(current)) current = current.expression
        else return null
    }
}

/** A literal bound (`100`, `-1`, `"x"`, `true`): data a schema reads, nothing that runs. */
const isLiteral = (expression) => ts.isNumericLiteral(expression) || ts.isStringLiteralLike(expression)
    || expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword
    || (ts.isPrefixUnaryExpression(expression) && ts.isNumericLiteral(expression.operand))

/** A statement a schema file may hold: an import, a type, or `export const X = <zod chain or a sibling schema>`. */
const statementProblem = (statement, zodNames, declared) => {
    if (ts.isImportDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) return null
    if (ts.isExportDeclaration(statement)) return null
    if (!ts.isVariableStatement(statement)) return `a ${ts.SyntaxKind[statement.kind]} is logic, not a schema value`
    for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        if (init && isLiteral(init) && ts.isIdentifier(declaration.name)) { declared.add(declaration.name.text); continue }
        const root = init ? rootOf(init) : null
        if (!ts.isIdentifier(declaration.name) || root === null || !(zodNames.has(root) || declared.has(root))) {
            return `${declaration.name.getText()} is not a zod schema (a schema file declares only zod chains and types)`
        }
        declared.add(declaration.name.text)
    }
    return null
}

/**
 * The reasons a source text is not a pure boundary schema file: it imports zod and holds nothing but imports, types and
 * `const X = <zod chain>` values, with no class, function, provider or other logic. An empty list means a value-only schema file.
 */
export const schemaFileProblems = (text) => {
    const sourceFile = ts.createSourceFile("subject.schema.ts", text, ts.ScriptTarget.Latest, true)
    const zodNames = importedNames(sourceFile, ZOD)
    if (zodNames.size === 0) return ["it imports no zod, so it is not a boundary schema"]
    const declared = importedNames(sourceFile, SIBLING_SCHEMA)
    return sourceFile.statements.flatMap((statement) => {
        const problem = statementProblem(statement, zodNames, declared)
        return problem === null ? [] : [problem]
    })
}

const CACHE = new Map()

/**
 * Whether the sibling `<name>.schema.ts` of a `<name>.schema.spec.ts` is a real boundary schema: it exists, lives in an owner tier of R304 and is
 * value-only (schemaFileProblems). Read from disk once per file and modification time.
 */
export const siblingIsValueSchema = (hfs, specFile) => {
    const sibling = normalizePath(path.resolve(specFile.replace(/\.spec\.ts$/u, ".ts")))
    if (!fs.existsSync(sibling) || !SCHEMA_TIERS.has(hfs.tierOf(sibling))) return false
    const stamp = fs.statSync(sibling).mtimeMs
    const cached = CACHE.get(sibling)
    if (cached?.stamp === stamp) return cached.ok
    const ok = schemaFileProblems(fs.readFileSync(sibling, "utf8")).length === 0
    CACHE.set(sibling, { stamp, ok })
    return ok
}
