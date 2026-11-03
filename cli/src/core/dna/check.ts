import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { z } from "zod"
import { defaultContractFile, entriesFor, judgePart, loadDnaContract } from "../../harness/dna.js"
import type { DnaBreak, DnaEntry, DnaVariant } from "../../harness/dna.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { HeadlessPage, findBrowser } from "./browser.js"
import { installProbe, settlePage } from "./measure.js"
import type { PageBegin, PageVariant } from "./measure.js"
import { serveFolder } from "./serve.js"
import type { StaticSite } from "./serve.js"
import { trimEndChars } from "../../shared/trim.js"
import { inOrder } from "../../harness/sequential.js"

/*
 * `starci dna check`: the measured laws of contexts/grammars/contract.yaml, judged on rendered pages in one headless browser. A
 * built Storybook is opened story by story in each family and theme; a url or a folder is opened by its routes. The laws that need
 * a context of their own (a coarse pointer, forced colours) or an act on the page (hover, press, a key) are not run here: the render
 * proof of packages/grammar (Playwright over the stories) owns pixels, and the lint gates own `source` laws.
 */

const ROOT_ATTRIBUTE = "data-grammar-family"
const DEFAULT_WIDTHS = [1920, 390] as const
const THEMES = ["light", "dark"] as const
const MAX_BROKEN_PER_PAGE = 60
const SHOWN_EXAMPLES = 3

interface Page {
    readonly label: string
    readonly url: string
    readonly story: boolean
}

const indexSchema = z.object({ entries: z.record(z.string(), z.object({ id: z.string(), type: z.string().optional() })) })
const beginSchema = z.object({ roots: z.number(), anyRoot: z.number() })
const reportsSchema = z.array(
    z.object({
        index: z.number(),
        evaluated: z.number(),
        skipped: z.array(z.string()),
        brokenCount: z.number(),
        broken: z.array(z.object({ path: z.string(), breaks: z.array(z.object({ metric: z.string(), measured: z.string(), want: z.string() })) })),
        error: z.string().optional(),
    }),
)

/** The row of one law in one family. */
export interface LawRow {
    readonly id: string
    readonly family: string
    readonly status: "green" | "red" | "not-exercised" | "known" | "not-run"
    readonly followUp: string | null
    readonly law: string
    readonly evaluated: number
    readonly broken: number
    readonly pages: number
    readonly notes: readonly string[]
    readonly examples: readonly { readonly page: string; readonly path: string; readonly breaks: readonly DnaBreak[] }[]
}

/** A row while the walk fills it in. */
interface Row {
    readonly id: string
    readonly family: string
    readonly followUp: string | null
    readonly law: string
    status: LawRow["status"]
    evaluated: number
    broken: number
    pages: number
    readonly notes: string[]
    readonly examplesMutable: LawRow["examples"][number][]
    readonly pageSet: Set<string>
}

const isDynamic = (variant: DnaVariant): boolean => variant.kind === "interaction" || variant.context.state !== null
const hasContext = (variant: DnaVariant): boolean => variant.context.pointer !== null || variant.context.viewport !== null || variant.context.theme !== null || variant.context.forcedColors || variant.context.reducedMotion

const numbersOf = (value: string | undefined): number[] => {
    if (value === undefined) return [...DEFAULT_WIDTHS]
    return value.split(",").map((item) => {
        const number = Number(item)
        if (!Number.isInteger(number) || number < 200 || number > 4000) throw new UsageError(`--widths takes widths in px between 200 and 4000, not ${item}`)
        return number
    })
}

const pagesOf = async (cwd: string, flags: { target: string | undefined; storybook: string | undefined; url: string | undefined; stories: string | undefined; routes: string | undefined }): Promise<{ pages: Page[]; site: StaticSite | undefined }> => {
    const given = [flags.target, flags.storybook, flags.url].filter((value) => value !== undefined)
    if (given.length !== 1) throw new UsageError("name one source: a <target> (url, built Storybook, folder or html file), --storybook or --url")
    const routes = (flags.routes ?? "/").split(",").map((route) => route.trim()).filter((route) => route !== "")
    const place = flags.url ?? flags.storybook ?? flags.target ?? ""
    if (/^https?:\/\//i.test(place)) return { pages: routes.map((route) => ({ label: route, url: `${trimEndChars(place, "/")}/${route.replace(/^\/+/, "")}`, story: false })), site: undefined }
    const path = resolve(cwd, place)
    if (!existsSync(path)) throw new Refusal("DNA_SOURCE", `${path} does not exist`)
    const folder = statSync(path).isDirectory() ? path : dirname(path)
    const site = await serveFolder(folder)
    if (statSync(path).isDirectory() && existsSync(join(path, "index.json")) && existsSync(join(path, "iframe.html"))) {
        const index = indexSchema.parse(JSON.parse(readFileSync(join(path, "index.json"), "utf8")))
        const pages = Object.values(index.entries)
            .filter((entry) => (entry.type === undefined || entry.type === "story") && (flags.stories === undefined || entry.id.includes(flags.stories)))
            .map((entry) => ({ label: entry.id, url: `${site.url}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story`, story: true }))
        return { pages, site }
    }
    const start = statSync(path).isDirectory() ? routes : [basename(path)]
    return { pages: start.map((route) => ({ label: route, url: `${site.url}/${route.replace(/^\/+/, "")}`, story: false })), site }
}

/** The data of a dna check. */
export interface DnaCheckData {
    readonly contract: string
    readonly widths: readonly number[]
    readonly pages: number
    readonly laws: readonly LawRow[]
    readonly problems: readonly string[]
    readonly verdict: "green" | "red"
    readonly report: readonly string[]
}

/** The line of one law that is red, not exercised or known, with its first examples when it is red. */
const lawEntry = (row: LawRow, family: string): string[] => {
    const lines: string[] = []
    const followUpSuffix = row.followUp === null ? "" : ` follow-up ${row.followUp}`
    const statusText = row.status === "not-exercised" ? "not exercised" : `${String(row.broken)} element(s) on ${String(row.pages)} page(s)`
    lines.push(`${row.status === "known" ? "known" : "red"} ${row.id} [${family}]${followUpSuffix} ${statusText}: ${row.law}`)
    if (row.status === "red") for (const example of row.examples.slice(0, SHOWN_EXAMPLES)) lines.push(`    ${example.page}: ${example.path}`, `      ${example.breaks[0]?.metric ?? ""} measured ${example.breaks[0]?.measured ?? ""}, wants ${example.breaks[0]?.want ?? ""}`)
    return lines
}

/** The report lines: a count per Grammar family and a line, with its first examples, for each law red, not exercised or known. */
const lawLines = (contract: ReturnType<typeof loadDnaContract>, laws: readonly LawRow[]): string[] => {
    const lines: string[] = []
    for (const family of contract.grammars) {
        const mine = laws.filter((row) => row.family === family)
        const count = (status: LawRow["status"]): number => mine.filter((row) => row.status === status).length
        lines.push(`${family}: ${String(mine.length)} law(s): ${String(count("green"))} green, ${String(count("red"))} red, ${String(count("not-exercised"))} not exercised, ${String(count("known"))} known (follow-up), ${String(count("not-run"))} not run here`)
        for (const row of mine.filter((candidate) => candidate.status === "red" || candidate.status === "not-exercised" || candidate.status === "known")) {
            lines.push(...lawEntry(row, family))
        }
    }
    return lines
}

/** Adds one law's report of one width to its row. */
const recordReport = (row: Row, report: ReturnType<typeof reportsSchema.parse>[number], seen: { readonly page: { readonly label: string }; readonly theme: string; readonly width: number }): void => {
    const { page, theme, width } = seen
    row.evaluated += report.evaluated
    row.broken += report.brokenCount
    if (report.error !== undefined && !row.notes.includes(`error: ${report.error}`)) row.notes.push(`error: ${report.error}`)
    for (const reason of report.skipped) if (!row.notes.includes(`skipped: ${reason}`)) row.notes.push(`skipped: ${reason}`)
    if (report.brokenCount > 0) row.pageSet.add(page.label)
    for (const broken of report.broken) if (row.examplesMutable.length < 200) row.examplesMutable.push({ page: `${page.label} ${theme}@${String(width)}`, path: broken.path, breaks: broken.breaks })
}

/** Adds what one width's reports found to the rows of their laws. */
const recordReports = (reports: ReturnType<typeof reportsSchema.parse>, variants: readonly { readonly index: number; readonly entry: DnaEntry }[], rows: Map<string, Row>, seen: { readonly family: string; readonly page: { readonly label: string }; readonly theme: string; readonly width: number }) => {
    const { family, page, theme, width } = seen
    for (const report of reports) {
        const item = variants.find((candidate) => candidate.index === report.index)
        const row = item === undefined ? undefined : rows.get(`${family}|${item.entry.id}`)
        if (item === undefined || row === undefined) continue
        recordReport(row, report, { page, theme, width })
    }
}

/** The page variants each Grammar family is judged on (the static ones), and a row per law not run yet. */
const planOf = (contract: ReturnType<typeof loadDnaContract>, rows: Map<string, Row>) => {
    const plan = contract.grammars.map((family) => {
        const variants: (PageVariant & { entry: DnaEntry })[] = []
        for (const entry of entriesFor(contract, family)) {
            const isStatic = entry.variants.some((variant) => variant.kind !== "source" && !isDynamic(variant) && !hasContext(variant))
            for (const variant of entry.variants) {
                const key = `${family}|${entry.id}`
                if (!rows.has(key)) {
                    const row = { id: entry.id, family, status: "not-run" as LawRow["status"], followUp: entry.followUp, law: entry.law, evaluated: 0, broken: 0, pages: 0, notes: isStatic ? [] : ["not run here: a source, contextual or acting law"], examplesMutable: [], pageSet: new Set<string>() }
                    rows.set(key, row)
                }
                if (variant.kind === "source" || isDynamic(variant) || hasContext(variant)) continue
                variants.push({ index: variants.length, variant, entry })
            }
        }
        return { family, variants }
    })
    return plan
}

export const dnaCheckVerb = defineVerb({
    path: ["dna", "check"],
    summary: "measure rendered UI (a built Storybook, a url with --routes, a static folder or html file) against the static DNA laws of the Grammar contract in both families, light and dark, at 1920 and 390; red per law id with element path and measured vs wanted",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: EVERYONE,
    schema: "starci/dna-check@2",
    flags: {
        target: { kind: "string", positional: true, summary: "a url, a built Storybook folder, a static folder or one html file" },
        storybook: { kind: "string", summary: "a built Storybook folder: every story is opened" },
        url: { kind: "string", summary: "the base url of a running app" },
        routes: { kind: "string", summary: "comma-separated routes under the url or folder (default /)" },
        stories: { kind: "string", summary: "only the Storybook stories whose id contains this text" },
        contract: { kind: "string", summary: "the grammar contract (default contexts/grammars/contract.yaml of the harness)" },
        widths: { kind: "string", summary: `comma-separated widths in px (default ${DEFAULT_WIDTHS.join(",")})` },
        browser: { kind: "string", summary: "the Chromium binary (default STARCI_BROWSER, else the installed Chrome, Edge or Chromium)" },
        timeout: { kind: "string", summary: "seconds a page may take to render its Grammar root (default 8)" },
        out: { kind: "string", summary: "a file to write the whole report to as json" },
    },
    run: async (context, flags) => {
        const contract = loadDnaContract(flags.contract === undefined ? defaultContractFile() : resolve(context.cwd, flags.contract))
        if (contract.entries.length === 0) throw new Refusal("DNA_NO_LAWS", `${contract.file} declares no measured mustKeep entry`)
        const waitMs = Math.round(Number(flags.timeout ?? "8") * 1000)
        if (!Number.isFinite(waitMs) || waitMs < 0) throw new UsageError(`--timeout takes seconds, not ${flags.timeout ?? ""}`)
        const widths = numbersOf(flags.widths)
        const { pages, site } = await pagesOf(context.cwd, flags)
        const tab = await HeadlessPage.launch(findBrowser(flags.browser), { width: 1280, height: 800 })
        try {
            if (pages.length === 0) throw new Refusal("DNA_NO_PAGES", "the source has no page to open")
            const rows = new Map<string, Row>()
            const problems: string[] = []
            const plan = planOf(contract, rows)
            await inOrder(pages, async (page) => {
                await inOrder(plan, async ({ family, variants }) => {
                    await inOrder(THEMES, async (theme) => {
                        context.progress(`dna: ${page.label} ${family} ${theme}`)
                        const url = page.story ? `${page.url}&globals=grammarFamily:${family};grammarTheme:${theme}` : page.url
                        await tab.media({ dark: theme === "dark" })
                        if (!(await tab.open(url, waitMs + 10_000))) {
                            problems.push(`${page.label}: ${url} did not finish loading`)
                            return
                        }
                        const rootSelector = `[${ROOT_ATTRIBUTE}="${family}"]`
                        await tab.evaluate(`(${settlePage.toString()})(${JSON.stringify({ rootSelector, waitMs })})`)
                        await tab.evaluate(`(${installProbe.toString()})(${judgePart.toString()})`)
                        const begin: PageBegin = { rootAttribute: ROOT_ATTRIBUTE, family, maxBroken: MAX_BROKEN_PER_PAGE }
                        const roots = beginSchema.parse(await tab.evaluate(`window.__dna.begin(${JSON.stringify(begin)})`))
                        if (roots.roots === 0) {
                            if (roots.anyRoot === 0 || !page.story) problems.push(`${page.label}: no [${ROOT_ATTRIBUTE}="${family}"] Grammar root rendered`)
                            return
                        }
                        await inOrder(widths, async (width) => {
                            await tab.viewport({ width, height: width >= 1000 ? 1080 : 844 })
                            const reports = reportsSchema.parse(await tab.evaluate(`window.__dna.run(${JSON.stringify(variants.map(({ index, variant }) => ({ index, variant })))})`))
                            recordReports(reports, variants, rows, { family, page, theme, width })
                        })
                    })
                })
            })
            const lawStatus = (ran: boolean, row: { readonly broken: number; readonly evaluated: number; readonly followUp: string | null }): LawRow["status"] => {
                if (!ran) return "not-run"
                if (row.broken > 0) return row.followUp === null ? "red" : "known"
                if (row.evaluated === 0) return row.followUp === null ? "not-exercised" : "known"
                return "green"
            }
            const laws: LawRow[] = [...rows.values()]
                .map(({ examplesMutable, pageSet, ...row }): LawRow => {
                    const ran = !row.notes.some((note) => note.startsWith("not run here"))
                    const status = lawStatus(ran, row)
                    return { ...row, status, pages: pageSet.size, examples: examplesMutable }
                })
                .sort((a, b) => a.family.localeCompare(b.family) || a.id.localeCompare(b.id))
            const failing = laws.filter((row) => row.status === "red" || row.status === "not-exercised")
            const evaluated = laws.reduce((sum, row) => sum + row.evaluated, 0)
            const lines = lawLines(contract, laws)
            for (const problem of problems.slice(0, 40)) lines.push(`red ${problem}`)
            const verdict = failing.length === 0 && problems.length === 0 && evaluated > 0 ? "green" : "red"
            lines.push(`${verdict}: ${String(evaluated)} element(s) judged on ${String(pages.length)} page(s) against ${String(contract.entries.length)} law(s) of ${contract.file}; ${String(failing.length)} failing`)
            const data: DnaCheckData = { contract: contract.file, widths, pages: pages.length, laws, problems, verdict, report: lines }
            if (flags.out !== undefined) writeFileSync(resolve(context.cwd, flags.out), JSON.stringify(data, null, 2))
            return { data, message: lines.join("\n"), exitCode: verdict === "red" ? 1 : 0 }
        } finally {
            await tab.close()
            await site?.close()
        }
    },
})
