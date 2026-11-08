/**
 * Tests for the Sonar way block of the back-end config factory (scripts/lib/sonar-way.mjs): the rules SonarSource's own port of the
 * Sonar way profile carries, at error over the files the scan judges, so `starci app check --gate lint` refuses what the scan would raise.
 *
 *   node --test src/sonar-way.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import path from "node:path"
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { TSESLint } from "@typescript-eslint/utils"
import tsParser from "@typescript-eslint/parser"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import sonarjs from "eslint-plugin-sonarjs"
import unicorn from "eslint-plugin-unicorn"
import { starciBeConfig } from "./index.ts"
import { SOURCE_FILES, SPEC_FILES } from "./lib/config.ts"
import { OUTSIDE_THE_SCAN_FILES, SONAR_SYNTAX_RULES } from "../runtime/scripts/lib/sonar-syntax-rules.mjs"
import { SONAR_WAY_EXTRA, SONAR_WAY_NOT_APPLICABLE, SONAR_WAY_TEST_RULES, sonarWayRules } from "../runtime/scripts/lib/sonar-way.mjs"
import { fixtureHfs } from "../fixtures/typed/tester.ts"
import { ruleNamed } from "../fixtures/rule-tester.ts"

const levelOf = (setting: unknown): unknown => (Array.isArray(setting) ? setting[0] : setting)

test("the factory's third block is Sonar way over the scanned source, every rule at error", async () => {
    const block = (await starciBeConfig({ hfs: fixtureHfs() }))[2]
    assert.ok(block, "the config has a Sonar way block")
    assert.deepEqual(block.files, [...SOURCE_FILES])
    assert.deepEqual(block.ignores, [...OUTSIDE_THE_SCAN_FILES])
    assert.ok(block.plugins?.["sonarjs"]?.rules && block.plugins["unicorn"]?.rules)
    const blockRules = block.rules
    assert.ok(blockRules, "the Sonar way block has rules")
    for (const [name, setting] of Object.entries(blockRules)) assert.equal(levelOf(setting), "error", `${name} is not an error`)
    assert.deepEqual(blockRules["sonarjs/cognitive-complexity"], ["error", 15])
    for (const name of ["sonarjs/slow-regex", "sonarjs/super-linear-regex", "sonarjs/no-alphabetical-sort", "sonarjs/no-nested-template-literals",
        "unicorn/no-thenable", "unicorn/no-useless-promise-resolve-reject", "prefer-promise-reject-errors", "@typescript-eslint/prefer-nullish-coalescing", "unicorn/prefer-native-coercion-functions", "unicorn/prefer-includes", "unicorn/prefer-set-has"]) {
        assert.ok(name in blockRules, `${name} is mapped`)
    }
    for (const owned of ["sonarjs/no-nested-conditional", "sonarjs/unused-import", "sonarjs/void-use", "sonarjs/deprecation", "sonarjs/no-unused-vars", "max-params"]) {
        assert.ok(!(owned in blockRules), `${owned} stays with its owner`)
    }
    for (const name of ["sonarjs/different-types-comparison", "sonarjs/function-return-type", "sonarjs/argument-type", "@typescript-eslint/prefer-optional-chain"]) {
        assert.equal(levelOf(blockRules[name]), "error", `${name} is not left to the server`)
    }
    assert.ok(!("unicorn/prefer-top-level-await" in blockRules), "a CommonJS back end has no top-level await (S7785 is not applicable)")
    assert.deepEqual(SONAR_WAY_NOT_APPLICABLE.be, { S7785: "top-level await does not exist in the CommonJS output of a back end" })
    assert.deepEqual(blockRules["unicorn/consistent-function-scoping"], ["error"], "arrow functions are judged too")
    assert.ok(!("no-duplicate-imports" in blockRules), "S3863 is the canon rule no-duplicate-import, which spares no separate type import")
})

test("every mapped row names a Sonar id and every sonarjs rule Sonar way switches on is mapped or owned", () => {
    const { rules, mapped } = sonarWayRules(sonarjs)
    assert.ok("unicorn/prefer-top-level-await" in rules && unicorn.rules?.["prefer-top-level-await"], "the front end (ESM) runs S7785")
    assert.ok(!("unicorn/prefer-top-level-await" in sonarWayRules(sonarjs, "be").rules), "the back end (CommonJS) does not")
    assert.ok(mapped.every((row) => /^S\d+$/.test(row.sonar)), "a row without its Sonar id")
    const recommendedRules = sonarjs.configs.recommended.rules
    assert.ok(recommendedRules, "sonarjs publishes its recommended rules")
    const on = Object.entries(recommendedRules).filter(([, setting]) => levelOf(setting) === "error").map(([name]) => name)
    assert.equal(on.filter((name) => !(name in rules)).length, 5, "only the five rules another owner enforces at error are not run under their sonarjs name")
    for (const row of SONAR_WAY_EXTRA.filter((entry) => entry.rule.startsWith("unicorn/"))) assert.ok(unicorn.rules?.[row.rule.slice("unicorn/".length)], `${row.rule} exists in the pinned unicorn`)
})

// typescript-eslint's Linter is ESLint's own class under the types that accept a typescript-eslint rule in a plugin
const linter = new TSESLint.Linter({ configType: "flat" })
const lint = (filename: string, code: string) => {
    const { rules } = sonarWayRules(sonarjs)
    const syntaxOnly = Object.fromEntries(Object.entries(rules).filter(([name]) => name === "sonarjs/no-nested-template-literals"))
    const config: TSESLint.FlatConfig.ConfigArray = [{ files: ["**/*.ts"], languageOptions: { parser: tsParser } }, { files: ["**/*.ts"], ignores: [...OUTSIDE_THE_SCAN_FILES], plugins: { sonarjs, "starci-be": { rules: { "max-params": ruleNamed(SONAR_SYNTAX_RULES, "max-params") } } }, rules: { ...syntaxOnly, "starci-be/max-params": "error" } }]
    return linter.verify(code, config, { filename }).map((message) => message.ruleId)
}
const NESTED = "export const label = (a: string, b: string) => `x ${`y ${a}`} ${b}`\n"
const MANY = "export function eight(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) { return a + b + c + d + e + f + g + h }\n"

test("a nested template literal or an eighth parameter is refused in scanned source and passes in a spec", () => {
    assert.deepEqual(lint("src/a.service.ts", NESTED), ["sonarjs/no-nested-template-literals"])
    assert.deepEqual(lint("src/a.service.ts", MANY), ["starci-be/max-params"])
    assert.deepEqual(lint("src/a.service.spec.ts", NESTED + MANY), [])
    assert.deepEqual(lint("src/a.service.ts", "export const label = (a: string) => `x ${a}`\n"), [])
})

// Parity with the server: a product scan with 0 issues on the server (Sonar way) and these forms are what the 1.7.19 lint reported
// there. The injected constructor and the narrowed comparison are clean source to the server, so they are clean to the lint.
const SERVER_CLEAN = [
    "const noDecoration = (): void => undefined",
    "function Injectable(): ClassDecorator { return noDecoration }",
    "@Injectable()",
    "export class DeskDailyService {",
    "    constructor(private readonly a: number, private readonly b: number, private readonly c: number, private readonly d: number,",
    "        private readonly e: number, private readonly f: number, private readonly g: number, private readonly h: number, private readonly i: number) {}",
    "}",
    "export const promoOf = (plan: { promo: number | null }, open: boolean) => {",
    "    const promo = open && plan.promo !== null",
    "    return promo && plan.promo !== null ? plan.promo : 0",
    "}",
    "export const without = (row: { isGlobal: boolean; name: string }) => { const { isGlobal: _isGlobal, ...rest } = row; return rest }",
    "",
].join("\n")

test("source the server passes is clean to the Sonar way rules: an injected constructor, a narrowed comparison, a rest-sibling omit", () => {
    const { rules } = sonarWayRules(sonarjs)
    const sonarjsRules = new Map(Object.entries(sonarjs.rules))
    // sonarjs marks a type-checked rule in its docs, a field ESLint's own docs type does not declare
    const requiresTypeChecking = (name: string): unknown => {
        const docs = sonarjsRules.get(name)?.meta?.docs
        return docs && "requiresTypeChecking" in docs ? docs.requiresTypeChecking : undefined
    }
    const syntax = Object.fromEntries(Object.entries(rules).filter(([name]) => !name.startsWith("@typescript-eslint/") && !(requiresTypeChecking(name.slice("sonarjs/".length)))))
    const config: TSESLint.FlatConfig.ConfigArray = [{ files: ["**/*.ts"], languageOptions: { parser: tsParser } },
        { files: ["**/*.ts"], plugins: { sonarjs, unicorn, "starci-be": { rules: { "max-params": ruleNamed(SONAR_SYNTAX_RULES, "max-params") } } }, rules: { ...syntax, "starci-be/max-params": "error" } }]
    assert.deepEqual(linter.verify(SERVER_CLEAN, config, { filename: path.join(process.cwd(), "src", "desk-daily.service.ts") }).map((message) => `${message.ruleId}:${message.line}`), [])
})

test("the specs are judged by the test-scoped Sonar way rules and by no other Sonar block", async () => {
    const block = (await starciBeConfig({ hfs: fixtureHfs() }))[3]
    assert.ok(block, "the config has a test-scope Sonar way block")
    assert.deepEqual(block.files, [...SPEC_FILES])
    assert.equal(block.ignores, undefined, "the block selects the specs by a positive selector and ignores nothing")
    assert.ok([...(block.files ?? [])].every((glob) => typeof glob === "string" && !glob.startsWith("!")), "no negated selector")
    assert.ok(block.plugins?.["sonarjs"]?.rules)
    const names = Object.keys(block.rules ?? {})
    assert.deepEqual(names, SONAR_WAY_TEST_RULES.map((name) => `sonarjs/${name}`))
    for (const name of ["sonarjs/prefer-specific-assertions", "sonarjs/no-duplicate-test-title", "sonarjs/composite-assertions"]) assert.equal(levelOf(block.rules?.[name]), "error", name)
})

const sonarjsByName = new Map(Object.entries(sonarjs.rules))

test("the test-scoped list is exactly the sonarjs rules whose Sonar scope is Tests and that the profile switches on", () => {
    const scopes = path.join(path.dirname(createRequire(import.meta.url).resolve("eslint-plugin-sonarjs/package.json")), "cjs")
    const tests = readdirSync(scopes).filter((dir) => /^S\d+$/.test(dir)).filter((dir) => /exports\.scope = 'Tests'/.test(readFileSync(path.join(scopes, dir, "generated-meta.js"), "utf8")))
    const listed = SONAR_WAY_TEST_RULES.map((name) => {
        const rule = sonarjsByName.get(name)
        assert.ok(rule, `sonarjs has ${name}`)
        return /(S\d+)/.exec(String(rule.meta?.docs?.url))?.[1]
    })
    const recommendedRules = sonarjs.configs.recommended.rules ?? {}
    const notInProfile = tests.filter((id) => !listed.includes(id))
    for (const id of notInProfile) {
        const name = [...sonarjsByName.keys()].find((candidate) => String(sonarjsByName.get(candidate)?.meta?.docs?.url).includes(`/${id}/`))
        assert.equal(levelOf(recommendedRules[`sonarjs/${name}`]), "off", `${id} (${name}) is a test rule the profile switches on and the list lacks`)
    }
    assert.ok(listed.every((id) => id && tests.includes(id)), "a listed rule is not test scoped")
})

// What the scan raised on the first real app and the form each ESLint rule reports, so the mirror is a case, not a promise.
const linterConfig = (rules: TSESLint.FlatConfig.Rules): TSESLint.FlatConfig.ConfigArray => [{ files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } } },
    { files: ["**/*.ts", "**/*.tsx"], plugins: { sonarjs, unicorn, "@typescript-eslint": tsPlugin }, rules }]
const mirrored = (name: string, code: string, filename = "src/a.service.ts"): string[] => {
    const entry = SONAR_WAY_EXTRA.find((row) => row.rule === name) ?? { rule: name }
    const rules = { [name]: ["error", ...(("options" in entry && entry.options) || [])] } as TSESLint.FlatConfig.Rules
    return linter.verify(code, linterConfig(rules), { filename }).map((message) => `${message.ruleId}${message.fix ? " [fix]" : ""}`)
}

const MIRRORED: ReadonlyArray<readonly [string, string, string, string]> = [
    // [rule, flagged, clean, Sonar id]
    ["unicorn/no-thenable", "export const a = { then() { return 1 } }", "export const a = { next() { return 1 } }", "S7739"],
    ["unicorn/no-useless-promise-resolve-reject", "export const a = async (x: number) => { return Promise.reject(x) }", "export const a = async (x: number) => { throw x }", "S7746"],
    ["prefer-promise-reject-errors", "export const a = () => Promise.reject(\"no\")", "export const a = () => Promise.reject(new Error(\"no\"))", "S6671"],
    ["prefer-regex-literals", "export const a = new RegExp(\"abc\")", "export const a = /abc/", "S6325"],
    ["@typescript-eslint/no-empty-function", "export class A { run() {} }", "export class A { run() { return 1 } }", "S1186"],
    ["no-sequences", "export const a = (1, 2)", "export const a = 2", "S878"],
    ["no-useless-escape", "export const a = \"\\d\"", "export const a = \"d\"", "S6535"],
    ["prefer-object-spread", "export const a = Object.assign({}, { b: 1 })", "export const a = { b: 1 }", "S6661"],
    ["unicorn/catch-error-name", "try { f() } catch (e) { g(e) }", "try { f() } catch (error) { g(error) }", "S7718"],
    ["unicorn/no-array-callback-reference", "export const a = [1].map(parse)", "export const a = [1].map((item) => parse(item))", "S7727"],
    ["unicorn/no-object-as-default-parameter", "export const a = (b = { c: 1 }) => b", "export const a = (b = 1) => b", "S7737"],
    ["unicorn/prefer-array-index-of", "export const a = [1].findIndex((x) => x === 2)", "export const a = [1].indexOf(2)", "S7753"],
    ["unicorn/prefer-at", "export const a = (xs: number[]) => xs[xs.length - 1]", "export const a = (xs: number[]) => xs.at(-1)", "S7755"],
    ["unicorn/prefer-math-min-max", "export const a = (x: number, y: number) => (x > y ? y : x)", "export const a = (x: number, y: number) => Math.min(x, y)", "S7766"],
    ["unicorn/prefer-string-replace-all", "export const a = \"x\".replace(/a/g, \"b\")", "export const a = \"x\".replaceAll(\"a\", \"b\")", "S7781"],
    ["unicorn/require-module-specifiers", "import {} from \"x\"", "import \"x\"", "S7787"],
]

test("each Sonar rule the first scan raised and the local lint missed is now an ESLint error (and a fix where the rule has one)", () => {
    for (const [name, flagged, clean, sonar] of MIRRORED) {
        const mapped = SONAR_WAY_EXTRA.some((row) => row.rule === name && row.sonar === sonar)
        assert.ok(mapped, `${sonar} is mapped to ${name}`)
        assert.ok(mirrored(name, flagged).some((id) => id.startsWith(name)), `${name} flags the ${sonar} form`)
        assert.deepEqual(mirrored(name, clean), [], `${name} passes the form that satisfies ${sonar}`)
    }
    for (const name of ["unicorn/no-useless-promise-resolve-reject", "unicorn/catch-error-name", "unicorn/prefer-array-index-of", "unicorn/prefer-at", "unicorn/prefer-math-min-max", "unicorn/prefer-string-replace-all", "prefer-object-spread"]) {
        const flagged = MIRRORED.find((row) => row[0] === name)?.[1] ?? ""
        assert.ok(mirrored(name, flagged).some((id) => id.endsWith("[fix]")), `${name} repairs the finding with --fix`)
    }
})

test("S7718: a catch parameter is `error` (`error_` when `error` is taken) and `cause` stays for a failure that is wrapped", () => {
    assert.deepEqual(mirrored("unicorn/catch-error-name", "try { f() } catch (cause) { throw new Error(\"x\", { cause }) }"), [])
    assert.deepEqual(mirrored("unicorn/catch-error-name", "try { f() } catch (error_) { g(error_) }"), [])
    assert.deepEqual(mirrored("unicorn/catch-error-name", "try { f() } catch (failure) { g(failure) }"), ["unicorn/catch-error-name [fix]"])
})

test("S7746 rewrites a returned rejection to a throw, and the back end's throw-domain-error accepts only a thrown domain error", () => {
    assert.deepEqual(mirrored("unicorn/no-useless-promise-resolve-reject", "export const a = async () => { return Promise.reject(new Error(\"x\")) }"), ["unicorn/no-useless-promise-resolve-reject [fix]"])
    assert.deepEqual(mirrored("unicorn/no-useless-promise-resolve-reject", "export const a = async () => { throw new Error(\"x\") }"), [])
})
