import { existsSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { defaultContractFile, entriesFor, judgeParity, judgeSample, loadDnaContract, readyTwinOf } from "../../harness/dna.js"
import type { DnaContract, DnaEntry, DnaSample } from "../../harness/dna.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { HeadlessPage, findBrowser } from "./browser.js"
import { measurePage, readStoryPairing, settlePage } from "./measure.js"
import type { PageInput, PageLaw, PageResult, StoryPairing } from "./measure.js"
import { serveFolder } from "./serve.js"
import type { StaticSite } from "./serve.js"

/** The attribute GrammarRoot stamps with its family (contexts/grammars/contract.yaml root.stamps). */
export const ROOT_ATTRIBUTE = "data-grammar-family"

const VIEWPORT = { width: 1280, height: 800 } as const
const DEFAULT_WAIT_MS = 8_000

/** One page the gate opens. */
interface PageTarget {
    readonly label: string
    readonly url: string
}

/** A page the gate opened with what it measured there. */
interface MeasuredPage {
    readonly target: PageTarget
    readonly result: PageResult
    /** The story's pairing parameters, read in a Storybook; null for a route or file. */
    readonly story: StoryPairing | null
    readonly storybook: boolean
}

/** One law an element breaks: where, what was measured and what the law wants. */
export interface DnaFinding {
    readonly id: string
    readonly law: string
    readonly family: string
    readonly page: string
    readonly path: string
    readonly metric: string
    readonly measured: number | string | boolean | null
    readonly expected: string
}

/** A page that could not be judged: no Grammar root, a family the contract does not know, a selector the page refused. */
export interface DnaProblem {
    readonly code: "DNA_NO_ROOT" | "DNA_UNKNOWN_FAMILY" | "DNA_SELECTOR" | "DNA_PAGE_LOAD" | "DNA_SKELETON_UNPAIRED"
    readonly page: string
    readonly detail: string
}

interface DnaCheckData {
    readonly contract: string
    readonly laws: Readonly<Record<string, number>>
    readonly pages: readonly { readonly label: string; readonly url: string; readonly roots: readonly string[]; readonly measured: number }[]
    readonly measured: number
    readonly findings: readonly DnaFinding[]
    readonly problems: readonly DnaProblem[]
    readonly red: readonly string[]
    readonly verdict: "green" | "red"
    /** The human report, line by line, so a json reader sees the same words. */
    readonly report: readonly string[]
}

const isUrl = (value: string): boolean => /^https?:\/\//i.test(value)
const isStorybook = (folder: string): boolean => existsSync(join(folder, "iframe.html")) && (existsSync(join(folder, "index.json")) || existsSync(join(folder, "stories.json")))
const isFolder = (path: string): boolean => existsSync(path) && statSync(path).isDirectory()

/** The stories of a built Storybook (index.json, or stories.json of an older build), optionally those whose id contains a filter. */
const storiesOf = (folder: string, base: string, filter: string | undefined): PageTarget[] => {
    const file = existsSync(join(folder, "index.json")) ? join(folder, "index.json") : join(folder, "stories.json")
    const index = JSON.parse(readFileSync(file, "utf8")) as { entries?: Record<string, { id: string; type?: string }>; stories?: Record<string, { id: string; type?: string }> }
    const entries = Object.values(index.entries ?? index.stories ?? {}).filter((entry) => entry.type === undefined || entry.type === "story")
    return entries
        .filter((entry) => filter === undefined || entry.id.includes(filter))
        .map((entry) => ({ label: entry.id, url: `${base}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story` }))
}

const routesOf = (routes: string | undefined, fallback: string): string[] =>
    (routes ?? fallback)
        .split(",")
        .map((route) => route.trim())
        .filter((route) => route !== "")

const joinRoute = (base: string, route: string): string => (isUrl(route) ? route : `${base.replace(/\/+$/, "")}/${route.replace(/^\/+/, "")}`)

interface Flags {
    readonly target: string | undefined
    readonly storybook: string | undefined
    readonly url: string | undefined
    readonly serve: string | undefined
    readonly routes: string | undefined
    readonly stories: string | undefined
}

/** Where the pages come from: a URL with routes, a Storybook build, or a static folder (or one html file) served on loopback. */
const resolveSource = (cwd: string, flags: Flags): { readonly kind: "url" | "storybook" | "folder"; readonly place: string; readonly route: string | undefined } => {
    const given = [flags.target, flags.storybook, flags.url, flags.serve].filter((value) => value !== undefined)
    if (given.length !== 1) throw new UsageError("name one source: a <target> (url, Storybook build, folder or html file), or --storybook, --url or --serve")
    if (flags.url !== undefined) return { kind: "url", place: flags.url, route: undefined }
    if (flags.storybook !== undefined) {
        const folder = resolve(cwd, flags.storybook)
        if (!isStorybook(folder)) throw new Refusal("DNA_SOURCE", `${folder} is not a built Storybook (iframe.html and index.json)`)
        return { kind: "storybook", place: folder, route: undefined }
    }
    if (flags.serve !== undefined) {
        const folder = resolve(cwd, flags.serve)
        if (!isFolder(folder)) throw new Refusal("DNA_SOURCE", `${folder} is not a folder`)
        return { kind: "folder", place: folder, route: undefined }
    }
    const target = flags.target ?? ""
    if (isUrl(target)) return { kind: "url", place: target, route: undefined }
    const path = resolve(cwd, target)
    if (!existsSync(path)) throw new Refusal("DNA_SOURCE", `${path} does not exist`)
    if (isFolder(path)) return { kind: isStorybook(path) ? "storybook" : "folder", place: path, route: undefined }
    return { kind: "folder", place: dirname(path), route: basename(path) }
}

const lawsByFamily = (contract: DnaContract): Record<string, PageLaw[]> =>
    Object.fromEntries(contract.grammars.map((family) => [family, entriesFor(contract, family).map((entry) => ({ id: entry.id, measure: entry.measure }))]))

/** Judges what one page measured: a finding per element that breaks a law, and the problems that stop a page being judged. */
const judgePage = (page: PageTarget, result: PageResult, entries: ReadonlyMap<string, DnaEntry>, contract: DnaContract) => {
    const findings: DnaFinding[] = []
    const problems: DnaProblem[] = []
    let measured = 0
    if (result.roots.length === 0) problems.push({ code: "DNA_NO_ROOT", page: page.label, detail: `no [${ROOT_ATTRIBUTE}] Grammar root rendered` })
    for (const root of result.roots) {
        if (!contract.grammars.includes(root.family)) {
            problems.push({ code: "DNA_UNKNOWN_FAMILY", page: page.label, detail: `${root.path} names the family "${root.family}", which ${contract.file} does not list` })
            continue
        }
        for (const law of root.laws) {
            const entry = entries.get(law.id)
            if (entry === undefined) continue
            if (law.error !== undefined) problems.push({ code: "DNA_SELECTOR", page: page.label, detail: `${law.id}: ${law.error}` })
            // A parity law compares two renders, so judgeParityPairs judges it once both pages are measured.
            if (entry.measure.metric === "skeleton-parity") continue
            for (const sample of law.samples) {
                measured += 1
                const verdict = judgeSample(entry.measure.expected, sample)
                if (!verdict.ok) {
                    findings.push({ id: entry.id, law: entry.law, family: root.family, page: page.label, path: sample.path, metric: entry.measure.metric, measured: sample.measured, expected: verdict.want })
                }
            }
        }
    }
    return { findings, problems, measured }
}

/** The samples of one law on one page, root by root in document order. */
const samplesOf = (result: PageResult, id: string): { readonly family: string; readonly samples: readonly DnaSample[] }[] =>
    result.roots.flatMap((root) => root.laws.filter((law) => law.id === id).map((law) => ({ family: root.family, samples: law.samples })))

/**
 * The ready twin of a loading page, or why there is none (null when the page is not a loading render). A story pairs by its
 * `parameters.dna` (the pairing paragraph of harness/dna.ts): a story of phase "loading" names its `pair`, and its twin is the story not in
 * the loading phase whose id is that pair or whose own dna.pair is the same, with the same `shape` arg when the loading story has
 * one. A route or file pairs by name: `<name>-skeleton` is the loading render of `<name>`.
 */
const readyTwin = (loading: MeasuredPage, pages: readonly MeasuredPage[]): MeasuredPage | string | null => {
    const story = loading.story
    // A story pairs by its parameters only; its id's spelling never makes it a loading render.
    if (loading.storybook && story === null) return null
    if (story !== null) {
        if (story.phase !== "loading") return null
        if (story.pair === null) return "it is in phase loading but names no parameters.dna.pair"
        const twin = pages.find((other) => {
            const meta = other.story
            if (meta === null || meta.phase === "loading") return false
            if (meta.id !== story.pair && meta.pair !== story.pair) return false
            return story.shape === null || meta.shape === story.shape
        })
        return twin ?? `no ready story of pair ${story.pair}${story.shape === null ? "" : ` and shape ${story.shape}`} was opened by this check`
    }
    const twinLabel = readyTwinOf(loading.target.label)
    if (twinLabel === null) return null
    return pages.find((other) => other.target.label === twinLabel) ?? `its ready twin ${twinLabel} was not opened by this check`
}

/**
 * Judges the skeleton-parity laws: each loading render against its ready twin (readyTwin), unit by unit in document order. A
 * loading render with no twin opened, or a unit count that differs between the two renders, is red as well.
 */
const judgeParityPairs = (measuredPages: readonly MeasuredPage[], contract: DnaContract) => {
    const findings: DnaFinding[] = []
    const problems: DnaProblem[] = []
    let measured = 0
    const parity = contract.entries.filter((entry) => entry.measure.metric === "skeleton-parity")
    for (const skeleton of measuredPages) {
        const ready = readyTwin(skeleton, measuredPages)
        if (ready === null) continue
        if (typeof ready === "string") {
            problems.push({ code: "DNA_SKELETON_UNPAIRED", page: skeleton.target.label, detail: ready })
            continue
        }
        const pair = `${skeleton.target.label} ~ ${ready.target.label}`
        for (const entry of parity) {
            const loading = samplesOf(skeleton.result, entry.id)
            const settled = samplesOf(ready.result, entry.id)
            const units = (rows: typeof loading): DnaSample[] => rows.flatMap((row) => row.samples)
            const loadingUnits = units(loading)
            const readyUnits = units(settled)
            const family = settled[0]?.family ?? loading[0]?.family ?? ""
            if (loadingUnits.length !== readyUnits.length) {
                findings.push({ id: entry.id, law: entry.law, family, page: pair, path: readyUnits[0]?.path ?? loadingUnits[0]?.path ?? entry.measure.selector, metric: entry.measure.metric, measured: `${String(loadingUnits.length)} unit(s) loading, ${String(readyUnits.length)} ready`, expected: "the same units in both renders" })
                continue
            }
            readyUnits.forEach((unit, index) => {
                const twin = loadingUnits[index]
                if (twin === undefined) return
                measured += 1
                for (const broken of judgeParity(entry.measure.expected.max ?? 1, twin, unit)) {
                    findings.push({ id: entry.id, law: entry.law, family, page: pair, path: broken.path, metric: entry.measure.metric, measured: broken.measured, expected: `every box within ${String(entry.measure.expected.max ?? 1)}px` })
                }
            })
        }
    }
    return { findings, problems, measured }
}

const describeFinding =(finding: DnaFinding): string =>
    `red ${finding.id} [${finding.family}] ${finding.page}: ${finding.path}\n    ${finding.metric} measured ${JSON.stringify(finding.measured)}, expected ${finding.expected} (${finding.law})`

/**
 * `starci dna check`: opens the rendered UI in a headless browser and measures every DNA law of contexts/grammars/contract.yaml
 * (the measured `mustKeep` entries, harness/dna.ts) on the elements of each Grammar root of the family the law binds. Red per law id
 * with the element path, the measured value and the expected one; red too when a page renders no Grammar root or nothing was
 * measured at all, since a gate that measured nothing proves nothing.
 */
export const dnaCheckVerb = defineVerb({
    path: ["dna", "check"],
    summary: "measure rendered UI (a url with --routes, a built Storybook, a static folder or html file) against the Grammar's DNA laws; red per law id with element path and measured vs expected",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/dna-check@1",
    flags: {
        target: { kind: "string", positional: true, summary: "a url, a built Storybook folder, a static folder or one html file" },
        storybook: { kind: "string", summary: "a built Storybook folder: every story is opened" },
        url: { kind: "string", summary: "the base url of a running app" },
        serve: { kind: "string", summary: "a static folder served on loopback for the check" },
        routes: { kind: "string", summary: "comma-separated routes under the url or folder (default /)" },
        stories: { kind: "string", summary: "only the Storybook stories whose id contains this text" },
        contract: { kind: "string", summary: "the grammar contract (default contexts/grammars/contract.yaml of the harness)" },
        browser: { kind: "string", summary: "the Chromium binary (default STARCI_BROWSER, else the installed Chrome, Edge or Chromium)" },
        wait: { kind: "string", summary: "milliseconds a page may take to render its Grammar root (default 8000)" },
    },
    run: async (context, flags) => {
        const contract = loadDnaContract(flags.contract === undefined ? defaultContractFile() : resolve(context.cwd, flags.contract))
        if (contract.entries.length === 0) {
            throw new Refusal("DNA_NO_LAWS", `${contract.file} declares no measured mustKeep entry (id, law, measure); the gate has nothing to hold the UI to`)
        }
        const waitMs = flags.wait === undefined ? DEFAULT_WAIT_MS : Number(flags.wait)
        if (!Number.isFinite(waitMs) || waitMs < 0) throw new UsageError(`--wait takes milliseconds, not ${flags.wait ?? ""}`)
        const source = resolveSource(context.cwd, flags)
        const binary = findBrowser(flags.browser)
        let site: StaticSite | undefined
        let page: HeadlessPage | undefined
        try {
            let targets: PageTarget[]
            if (source.kind === "url") targets = routesOf(flags.routes, "/").map((route) => ({ label: route, url: joinRoute(source.place, route) }))
            else {
                site = await serveFolder(source.place)
                const base = site.url
                if (source.kind === "storybook") targets = storiesOf(source.place, base, flags.stories)
                else targets = routesOf(flags.routes, source.route ?? "/").map((route) => ({ label: route, url: joinRoute(base, route) }))
            }
            if (targets.length === 0) throw new Refusal("DNA_NO_PAGES", "the source has no page to open (no story matched, or no route)")
            page = await HeadlessPage.launch(binary, VIEWPORT)
            const input: PageInput = { rootAttribute: ROOT_ATTRIBUTE, laws: lawsByFamily(contract) }
            const entries = new Map(contract.entries.map((entry) => [entry.id, entry]))
            const findings: DnaFinding[] = []
            const problems: DnaProblem[] = []
            const pages: DnaCheckData["pages"][number][] = []
            const measuredPages: MeasuredPage[] = []
            for (const target of targets) {
                context.progress(`dna: ${target.label}`)
                if (!(await page.open(target.url, waitMs + 10_000))) {
                    problems.push({ code: "DNA_PAGE_LOAD", page: target.label, detail: `${target.url} did not finish loading` })
                    continue
                }
                await page.evaluate(`(${settlePage.toString()})(${JSON.stringify({ rootAttribute: ROOT_ATTRIBUTE, waitMs })})`)
                const result = (await page.evaluate(`(${measurePage.toString()})(${JSON.stringify(input)})`)) as PageResult
                const judged = judgePage(target, result, entries, contract)
                findings.push(...judged.findings)
                problems.push(...judged.problems)
                pages.push({ label: target.label, url: target.url, roots: result.roots.map((root) => root.family), measured: judged.measured })
                const story = source.kind === "storybook" ? ((await page.evaluate(`(${readStoryPairing.toString()})()`)) as StoryPairing | null) : null
                measuredPages.push({ target, result, story, storybook: source.kind === "storybook" })
            }
            const parity = judgeParityPairs(measuredPages, contract)
            findings.push(...parity.findings)
            problems.push(...parity.problems)
            const measured = pages.reduce((sum, item) => sum + item.measured, 0) + parity.measured
            const red = [...new Set(findings.map((finding) => finding.id))].sort((a, b) => a.localeCompare(b))
            const verdict = findings.length === 0 && problems.length === 0 && measured > 0 ? "green" : "red"
            const laws = Object.fromEntries(contract.grammars.map((family) => [family, entriesFor(contract, family).length]))
            const lines = [
                ...findings.map(describeFinding),
                ...problems.map((problem) => `red ${problem.code} ${problem.page}: ${problem.detail}`),
                ...(measured === 0 ? ["red DNA_NOTHING_MEASURED: no element on any page matched a law; the gate proves nothing"] : []),
                `${verdict}: ${String(measured)} element(s) measured on ${String(pages.length)} page(s) against ${String(contract.entries.length)} law(s) of ${contract.file}`,
                `red ids: [${red.join(", ")}]`,
            ]
            const data: DnaCheckData = { contract: contract.file, laws, pages, measured, findings, problems, red, verdict, report: lines }
            return { data, message: lines.join("\n"), exitCode: verdict === "red" ? 1 : 0 }
        } finally {
            await page?.close()
            await site?.close()
        }
    },
})
