/**
 * R279 BE_THIRD_PARTY_OWNER: dependencies outside the pure-library and framework vocabulary belong to one integration.
 *
 * The SDK inventory comes from the app-root package.json, not a list of SDK names. An unknown dependency is therefore
 * subject to ownership immediately. R90's infrastructure table remains authoritative for its existing libraries;
 * framework packages here supply composition, transport and persistence types that other canon rules already judge.
 * The HFS view decides every source file's tier and owner, including imports in specs and provider support files.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { isBuiltin } from "node:module"
import { dirname, join, resolve } from "node:path"
import ts from "typescript"
import { hfsOf, inTestWorld } from "./lib/hfs.ts"
import { moduleReferences } from "./lib/import-source.ts"
import { isSpecFile } from "./lib/path.ts"
import type { Recommended, RuleModule, Rules } from "./lib/rule.ts"
import type { HfsView } from "./lib/hfs.ts"

const PURE = new Set([
    "class-transformer", "class-validator", "rxjs", "reflect-metadata", "tslib", "zod", "lodash", "lodash-es",
    "ramda", "decimal.js", "big.js", "bignumber.js", "uuid", "nanoid", "graphql", "graphql-scalars", "graphql-tag",
    "dataloader", "fast-json-stable-stringify", "ajv", "yaml", "js-yaml", "semver",
])
const FRAMEWORK = new Set([
    "@nestjs/common", "@nestjs/core", "@nestjs/cqrs", "@nestjs/graphql", "@nestjs/apollo", "@nestjs/platform-express",
    "@nestjs/typeorm", "@nestjs/swagger", "@nestjs/mapped-types", "@nestjs/throttler", "@apollo/server",
    "@as-integrations/express5", "express", "nest-commander", "typeorm",
])
const TEST_LIBRARIES = new Set(["@nestjs/testing", "@starci/jest-preset", "@starci/test-world", "@jest/globals", "jest", "jest-mock"])
/** The app dependency declarations (name -> package). */
type Dependencies = Map<string, string>

const DEPENDENCIES = new WeakMap<HfsView, Dependencies>()
/** The module references of each integration file; read only when an integration file is judged. */
const INTEGRATIONS = new WeakMap<HfsView, Map<string, Set<string>>>()
const SOURCE = /\.[cm]?[jt]sx?$/
const GENERATED = new Set(["node_modules", "dist", "coverage", ".git"])

/** The package root of a bare module specifier, including a scoped package's subpaths. */
const packageOf = (specifier: string) => {
    if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#") || isBuiltin(specifier)) return null
    const parts = specifier.split("/")
    return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

/** A file that the back-end slot view classifies as executable source or a test. */
const inSource = (hfs: HfsView, file: string) => {
    const tier = hfs.tierOf(file)
    return (tier !== null && tier !== "none") || hfs.slotOf(file)?.startsWith("be.tests.") === true
}

/** Every literal module reference in a source file, including dynamic imports, require and re-exports. */
const referencesOf = (file: string, text: string) => {
    const found = new Set<string>()
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const add = (node: ts.Node | undefined) => {
        if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) found.add(node.text)
    }
    const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier)
        else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression)
        else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) add(node.arguments[0])
        ts.forEachChild(node, visit)
    }
    visit(source)
    return found
}

/**
 * The app's dependency declarations, read once for this HFS view.
 * No ancestor search: be/ has the app-root package.json immediately above it; standalone fixtures may put it at root.
 */
const dependenciesOf = (hfs: HfsView): Dependencies => {
    const cached = DEPENDENCIES.get(hfs)
    if (cached) return cached
    const appManifest = join(dirname(hfs.repoRoot), "package.json")
    const manifest = existsSync(appManifest) ? appManifest : join(hfs.repoRoot, "package.json")
    if (!existsSync(manifest)) throw new Error("third-party-import-owner needs the app-root package.json beside be/ to derive SDK ownership")
    const declaration: unknown = JSON.parse(readFileSync(manifest, "utf8"))
    const dependencies = new Map<string, string>()
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) {
        const declared: unknown = typeof declaration === "object" && declaration !== null ? Reflect.get(declaration, section) : undefined
        for (const [name, version] of Object.entries(declared ?? {})) {
            if (/^(?:workspace:|file:|link:)/.test(String(version))) continue
            const alias = /^npm:((?:@[^/]+\/)?[^@]+)(?:@|$)/.exec(String(version))
            dependencies.set(name, alias?.[1] ?? name)
        }
    }
    DEPENDENCIES.set(hfs, dependencies)
    return dependencies
}

/**
 * The SDK imports of all integration owners, read once for this HFS view. Only a file of an integration owner needs them (to see whether
 * another owner imports the same SDK), so every other file is judged without walking the tree.
 */
const integrationsOf = (hfs: HfsView): Map<string, Set<string>> => {
    const cached = INTEGRATIONS.get(hfs)
    if (cached) return cached
    const byFile = new Map<string, Set<string>>()
    const walk = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (GENERATED.has(entry.name) || entry.isSymbolicLink()) continue
            const file = join(directory, entry.name)
            if (entry.isDirectory()) walk(file)
            else if (SOURCE.test(entry.name) && hfs.tierOf(file) === "integrations") byFile.set(resolve(file), referencesOf(file, readFileSync(file, "utf8")))
        }
    }
    walk(hfs.repoRoot)
    INTEGRATIONS.set(hfs, byFile)
    return byFile
}

/** The table already owns this import (including a package subpath); R90 alone judges it. */
const inInfraTable = (hfs: HfsView, specifier: string) => Object.keys(hfs.ruleParams.infraOwners).some((key) => specifier === key || specifier.startsWith(`${key}/`))

/** The declared SDK identity, or null for an import that belongs to another existing concern. */
const sdkOf = (hfs: HfsView, dependencies: Map<string, string>, file: string, specifier: string) => {
    const name = packageOf(specifier)
    const dependency = name === null || name === undefined ? undefined : dependencies.get(name)
    if (!dependency || inInfraTable(hfs, specifier) || PURE.has(dependency) || FRAMEWORK.has(dependency)) return null
    const isTest = isSpecFile(file) || hfs.slotOf(file)?.startsWith("be.tests.") === true
    if (isTest && TEST_LIBRARIES.has(dependency)) return null
    if (inTestWorld(hfs, file) && (dependency === "testcontainers" || dependency.startsWith("@testcontainers/"))) return null
    return dependency
}

/** Every third-party SDK import stays in a single integrations/<provider> capability. */
export const thirdPartyImportOwner: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "BE_THIRD_PARTY_OWNER: a declared third-party SDK is imported only by one integration owner." },
        schema: [],
        messages: {
            foreign: "[BE_THIRD_PARTY_OWNER] `{{name}}` is a third-party dependency from package.json. Import its SDK only inside one `integrations/<provider>` capability and inject that integration's public API here.",
            multiple: "[BE_THIRD_PARTY_OWNER] `{{name}}` is imported by multiple integrations: {{owners}}. Keep its SDK, credentials and protocol mapping in one `integrations/<provider>` owner.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const file = context.filename
        if (!inSource(hfs, file)) return {}
        return moduleReferences(({ source, value }) => {
            // Relative paths, node builtins and the infrastructure table need no dependency manifest.
            if (packageOf(value) === null || inInfraTable(hfs, value)) return
            const dependencies = dependenciesOf(hfs)
            const sdk = sdkOf(hfs, dependencies, file, value)
            if (sdk === null) return
            const here = hfs.ownerOf(file)
            if (hfs.tierOf(file) !== "integrations" || here === null) {
                context.report({ node: source, messageId: "foreign", data: { name: value } })
                return
            }
            const owners = new Set<string | null>([here])
            for (const [other, references] of integrationsOf(hfs)) {
                // ESLint's current buffer replaces the on-disk text of this file.
                if (other === resolve(file)) continue
                if ([...references].some((reference) => sdkOf(hfs, dependencies, other, reference) === sdk)) owners.add(hfs.ownerOf(other))
            }
            if (owners.size > 1) context.report({ node: source, messageId: "multiple", data: { name: sdk, owners: [...owners].sort().map((owner) => `\`${owner}\``).join(", ") } })
        })
    },
}

/** The published rule and its required severity. */
export const rules = { "third-party-import-owner": thirdPartyImportOwner } satisfies Rules
export const recommended: Recommended = { "starci-be/third-party-import-owner": "error" }
