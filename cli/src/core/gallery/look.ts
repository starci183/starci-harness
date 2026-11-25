import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { Refusal, UsageError } from "../../shared/errors.js"
import { git, mainCheckout } from "../../shared/git.js"
import { WRITERS, defineVerb } from "../../shared/verb.js"
import { loadSlotRules, slotRoot, withSlot } from "../../harness/slots.js"
import { projectOf, registeredRoots } from "../../harness/vps/alerts.js"
import { appRootOf, appStore } from "../app/alerts.js"
import { laneHolder, positiveInt, waitSeconds } from "../slot/holder.js"

/** The app's own declaration of how its running stack is looked at: `gallery/look.json` (contexts/project/gallery.md PROJECT-GALLERY-7 step 2b). */
export const LOOK_CONFIG = "gallery/look.json"

/** The widths of a look by default: the two of every gallery shot (PROJECT-GALLERY-1). */
export const DEFAULT_WIDTHS: readonly number[] = [1440, 390]

/** The viewport height of each width; a look is a full-page shot, so the height only decides what the first paint sees. */
const HEIGHTS: Readonly<Record<number, number>> = { 1440: 900, 390: 844 }

const envSchema = z.strictObject({
    /** The web origin the owner opens (the dev tunnel host). */
    web: z.url(),
    /** The api the sign-in is posted to. */
    api: z.url(),
    /** The Origin header the api's CORS guard accepts (default: the web origin). */
    origin: z.url().optional(),
    signIn: z.strictObject({
        /** The api path of the password sign-in, posted as JSON `{ email, password }`; its Set-Cookie headers are the session. */
        path: z.string().startsWith("/"),
        email: z.string().min(3),
        /** Where the password is sealed: `.starcistacks/<env>/secrets/<member>.enc.yaml`, key `key`. */
        password: z.strictObject({ member: z.string().min(1), key: z.string().min(1) }),
    }),
    /** A workspace-scoped app: `route` holds `{workspace}` and prefixes every path; `default` is the demo workspace with real data. */
    workspace: z.strictObject({ route: z.string().includes("{workspace}"), default: z.string().min(1).optional() }).optional(),
})

const lookSchema = z.strictObject({
    schema: z.literal("starci/app-look@1"),
    envs: z.record(z.string(), envSchema),
})

export type LookEnv = z.infer<typeof envSchema>

/** The look settings of one environment from the text of `gallery/look.json`; refused when the file or the environment is missing or malformed. */
export const lookEnvOf = (text: string | null, env: string): LookEnv => {
    if (text === null) throw new Refusal("LOOK_NOT_DECLARED", `${LOOK_CONFIG} is missing: declare { "schema": "starci/app-look@1", "envs": { "${env}": { "web", "api", "signIn": { "path", "email", "password": { "member", "key" } }, "workspace"?: { "route", "default"? } } } } (contexts/project/gallery.md PROJECT-GALLERY-7 step 2b)`)
    let json: unknown
    try {
        json = JSON.parse(text)
    } catch {
        throw new Refusal("LOOK_CONFIG_INVALID", `${LOOK_CONFIG} is not JSON`)
    }
    const parsed = lookSchema.safeParse(json)
    if (!parsed.success) throw new Refusal("LOOK_CONFIG_INVALID", `${LOOK_CONFIG}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`)
    const settings = parsed.data.envs[env]
    if (settings === undefined) throw new Refusal("LOOK_NOT_DECLARED", `${LOOK_CONFIG} declares no environment ${env} (it declares ${Object.keys(parsed.data.envs).join(", ") || "none"})`)
    return settings
}

/** Values of a repeatable, comma-separated list flag, trimmed, empty ones dropped. */
export const listValues = (values: readonly string[]): string[] => values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter((value) => value !== "")

/** The widths of `--widths`, each a positive integer (default 1440 and 390). */
export const widthsOf = (values: readonly string[]): number[] => {
    const listed = listValues(values)
    if (listed.length === 0) return [...DEFAULT_WIDTHS]
    return listed.map((value) => {
        const width = Number(value)
        if (!Number.isSafeInteger(width) || width < 200 || width > 4000) throw new UsageError(`--widths takes pixel widths between 200 and 4000, not "${value}"`)
        return width
    })
}

/** One shot a look takes. */
export interface LookShot {
    readonly route: string
    readonly url: string
    readonly width: number
    readonly file: string
}

/** The file name of one shot: the route as a slug, then the width. */
export const shotFile = (route: string, width: number): string => {
    const slug = route.replace(/^\/+|\/+$/gu, "").replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "")
    return `${slug === "" ? "root" : slug}-${String(width)}.png`
}

/**
 * The shots of a look: every route at every width. A route is prefixed by the environment's workspace route when a workspace is chosen,
 * unless it already starts with the route's fixed head (`/workspaces/`), so a full path is taken as typed.
 */
export const lookPlan = (settings: LookEnv, paths: readonly string[], widths: readonly number[], workspace: string | undefined): LookShot[] => {
    if (paths.length === 0) throw new UsageError("--paths names at least one route of the screens the change reaches (/chat,/leads)")
    const head = settings.workspace?.route.split("{workspace}")[0] ?? ""
    const web = settings.web.replace(/\/+$/u, "")
    return paths.flatMap((path) => {
        if (!path.startsWith("/")) throw new UsageError(`--paths takes routes that start with /, not "${path}"${/^[A-Za-z]:\//u.test(path) ? " (a POSIX shell on Windows rewrote it to a folder: set MSYS_NO_PATHCONV=1)" : ""}`)
        const scoped = settings.workspace !== undefined && workspace !== undefined && !(head !== "" && path.startsWith(head))
        const full = scoped ? `${(settings.workspace?.route ?? "").replaceAll("{workspace}", encodeURIComponent(workspace))}${path === "/" ? "" : path}` : path
        return widths.map((width) => ({ route: path, url: `${web}${full}`, width, file: shotFile(path, width) }))
    })
}

/** One cookie handed to the browser. */
export interface LookCookie {
    readonly name: string
    readonly value: string
    readonly domain: string
    readonly path: string
    readonly secure: boolean
    readonly httpOnly: boolean
    readonly sameSite: "Strict" | "Lax" | "None"
}

/** The SameSite of a cookie as the browser takes it: Lax unless the header says Strict or None. */
const sameSiteOf = (same: string | undefined): LookCookie["sameSite"] => (same === "strict" ? "Strict" : same === "none" ? "None" : "Lax")

/**
 * The session cookies of a sign-in's Set-Cookie headers, for the web host. Cookies that name a Domain the web host is under are the
 * session (the api and the web share a parent domain); when none does, the host-only cookies are bound to the web host. A host-only
 * cookie is also bound to the host that set it, the `api` host when it differs from the web host, as a browser keeps it: an app whose
 * web calls its api across hosts with the api's own host-only refresh cookie (no shared cookie domain in dev) is signed in. A cookie whose
 * Domain the web host is not under never reaches the browser. A header that clears a cookie (an Expires in the past, a Max-Age of 0 or
 * less) sets nothing, and of several headers for one name, domain and path the last one wins, as a browser keeps them.
 */
export const sessionCookies = (setCookies: readonly string[], web: string, now: Date = new Date(), api?: string): LookCookie[] => {
    const host = new URL(web).hostname
    const apiHost = api === undefined ? undefined : new URL(api).hostname
    const secureWeb = new URL(web).protocol === "https:"
    const parsed = setCookies.map((header) => {
        const [pair = "", ...attributes] = header.split(";").map((part) => part.trim())
        const at = pair.indexOf("=")
        const attribute = (name: string): string | undefined => {
            const found = attributes.find((each) => each.toLowerCase().startsWith(`${name.toLowerCase()}=`) || each.toLowerCase() === name.toLowerCase())
            if (found === undefined) return undefined
            const eq = found.indexOf("=")
            return eq < 0 ? "" : found.slice(eq + 1)
        }
        const domain = attribute("Domain")?.replace(/^\./u, "").toLowerCase()
        const same = attribute("SameSite")?.toLowerCase()
        const maxAge = attribute("Max-Age")
        const expires = attribute("Expires")
        const cleared = maxAge !== undefined ? Number(maxAge) <= 0 : expires !== undefined && Date.parse(expires) <= now.getTime()
        return {
            cleared,
            name: at < 1 ? "" : pair.slice(0, at),
            value: at < 1 ? "" : pair.slice(at + 1),
            domain,
            path: attribute("Path") ?? "/",
            secure: attribute("Secure") !== undefined || (same === "none" && secureWeb),
            httpOnly: attribute("HttpOnly") !== undefined,
            sameSite: sameSiteOf(same),
        }
    }).filter((cookie) => cookie.name !== "")
    const kept = new Map<string, (typeof parsed)[number]>()
    for (const cookie of parsed) {
        const key = `${cookie.name}|${cookie.domain ?? ""}|${cookie.path}`
        kept.delete(key)
        if (!cookie.cleared) kept.set(key, cookie)
    }
    const live = [...kept.values()]
    const under = (domain: string): boolean => host === domain || host.endsWith(`.${domain}`)
    const shared = live.filter((cookie) => cookie.domain !== undefined && under(cookie.domain))
    const hostOnly = live.filter((cookie) => cookie.domain === undefined)
    const onApi = apiHost === undefined || apiHost === host ? [] : hostOnly.map((cookie) => ({ ...cookie, domain: apiHost }))
    const chosen = [...(shared.length > 0 ? shared.map((cookie) => ({ ...cookie, domain: `.${cookie.domain ?? host}` })) : hostOnly.map((cookie) => ({ ...cookie, domain: host }))), ...onApi]
    return chosen.map(({ name, value, domain, path, secure, httpOnly, sameSite }) => ({ name, value, domain, path, secure, httpOnly, sameSite }))
}

/** One shot as the index records it. */
export interface LookIndexShot {
    readonly route: string
    readonly url: string
    readonly width: number
    readonly file: string
    readonly time: string
    /** The URL the page settled on; a sign-in page here means the session did not hold. */
    readonly landed: string
    readonly status: number | null
    readonly problem: string | null
}

/** The index a look writes beside its PNGs (`index.json`): what was looked at, when, at which sha of the running dev. */
export interface LookIndex {
    readonly schema: "starci/app-look-index@1"
    readonly app: string
    readonly env: string
    readonly web: string
    readonly workspace: string | null
    readonly devSha: string | null
    readonly startedAt: string
    readonly shots: readonly LookIndexShot[]
}

/** The index of a finished look, its shots in plan order. */
export const lookIndex = (head: Omit<LookIndex, "schema" | "shots">, shots: readonly LookIndexShot[]): LookIndex => ({ schema: "starci/app-look-index@1", ...head, shots })

/** Whether a settled URL is the app's sign-in page (the look then saw the signed-out app, not the screen). */
export const signedOut = (landed: string): boolean => /\/(login|sign-?in)(\/|$)/iu.test(new URL(landed).pathname)

/** The stamp of a look folder: UTC, sortable, no separators a path refuses. */
export const lookStamp = (at: Date): string => at.toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z")

/** The app root `--app` names: the app around the working folder when it is that project (or none is named), a folder, or a checkout registered with this harness. */
const appRoot = (cwd: string, app: string | undefined): string => {
    let here: string | undefined
    try {
        here = appRootOf(cwd)
    } catch {
        here = undefined
    }
    if (app === undefined || app === "") {
        if (here === undefined) throw new Refusal("APP_NOT_FOUND", `${cwd} is in no app: run it in the app's lane worktree or name it with --app`)
        return here
    }
    if (here !== undefined && (projectOf(here) === app || basename(here) === app)) return here
    const folder = resolve(cwd, app)
    if (existsSync(join(folder, "hfs.json"))) return folder
    const registered = registeredRoots().find((root) => projectOf(root) === app || basename(root) === app)
    if (registered === undefined) throw new Refusal("APP_NOT_FOUND", `no app ${app}: not the app around ${cwd}, not a folder, not a checkout registered with this harness`)
    return registered
}

/** The playwright-core the look drives: PLAYWRIGHT_CORE_DIR, else the app's own, else the gallery tools folder the app gallery shoots with. */
const loadChromium = async (root: string): Promise<{ launch: (options: object) => Promise<Browser> }> => {
    const candidates: string[] = []
    const fromEnv = process.env.PLAYWRIGHT_CORE_DIR
    if (fromEnv !== undefined && fromEnv !== "") candidates.push(join(fromEnv, "index.js"))
    try {
        candidates.push(createRequire(join(root, "package.json")).resolve("playwright-core"))
    } catch {
        // the app does not install it
    }
    candidates.push(join(homedir(), ".starci-gallery-tools", "node_modules", "playwright-core", "index.js"))
    for (const candidate of candidates) {
        if (!existsSync(candidate)) continue
        const loaded = (await import(pathToFileURL(candidate).href)) as { chromium?: { launch: (options: object) => Promise<Browser> }; default?: { chromium?: { launch: (options: object) => Promise<Browser> } } }
        const chromium = loaded.chromium ?? loaded.default?.chromium
        if (chromium !== undefined) return chromium
    }
    throw new Refusal("LOOK_PLAYWRIGHT_MISSING", `no playwright-core found (PLAYWRIGHT_CORE_DIR, the app's node_modules, ~/.starci-gallery-tools/node_modules): npm install --prefix ~/.starci-gallery-tools playwright-core`)
}

/** The slice of playwright-core the look uses. */
interface Browser {
    newContext: (options: object) => Promise<BrowserContext>
    close: () => Promise<void>
}
interface BrowserContext {
    addCookies: (cookies: readonly LookCookie[]) => Promise<void>
    newPage: () => Promise<Page>
    close: () => Promise<void>
}
interface Page {
    goto: (url: string, options: object) => Promise<{ status: () => number } | null>
    waitForLoadState: (state: string, options: object) => Promise<void>
    waitForTimeout: (ms: number) => Promise<void>
    addStyleTag: (options: object) => Promise<unknown>
    screenshot: (options: object) => Promise<unknown>
    url: () => string
}

/** Whether `url` answers at all (any status below 500) within 10 s. */
const reachable = async (url: string): Promise<boolean> => {
    try {
        return (await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "manual" })).status < 500
    } catch {
        return false
    }
}

/** Signs in as the declared owner through the app's api and returns the session cookies for the web host; the password is read from custody and never printed. */
const signIn = async (root: string, env: string, settings: LookEnv): Promise<LookCookie[]> => {
    const file = join(root, ".starcistacks", env, "secrets", `${settings.signIn.password.member}.enc.yaml`)
    if (!existsSync(file)) throw new Refusal("LOOK_SECRET_MISSING", `${file} is not sealed: the look signs in with ${settings.signIn.password.key} of it`)
    let password: string | undefined
    try {
        password = (await appStore(root)).open(file)[settings.signIn.password.key]
    } catch (error: unknown) {
        throw new Refusal("LOOK_SECRET_UNREADABLE", `${file} does not open on this machine: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : "sops refused"}`)
    }
    if (password === undefined || password === "") throw new Refusal("LOOK_SECRET_MISSING", `${file} holds no ${settings.signIn.password.key}`)
    const origin = new URL(settings.origin ?? settings.web).origin
    const response = await fetch(`${settings.api.replace(/\/+$/u, "")}${settings.signIn.path}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ email: settings.signIn.email, password: password.trim() }), signal: AbortSignal.timeout(30_000) })
    if (response.status < 200 || response.status > 299) throw new Refusal("LOOK_SIGN_IN_REFUSED", `the sign-in of ${settings.signIn.email} at ${settings.api}${settings.signIn.path} answered ${String(response.status)}`)
    const cookies = sessionCookies(response.headers.getSetCookie(), settings.web, new Date(), settings.api)
    if (cookies.length === 0) throw new Refusal("LOOK_SIGN_IN_NO_COOKIE", `the sign-in at ${settings.api}${settings.signIn.path} set no cookie the web host ${new URL(settings.web).hostname} receives`)
    return cookies
}

/** The sha the running dev serves: HEAD of the app's main checkout (the one `dev sync` moves), else origin/dev. */
const devShaOf = async (root: string): Promise<string | null> => {
    try {
        return (await git(await mainCheckout(root), ["rev-parse", "HEAD"])).trim()
    } catch {
        try {
            return (await git(root, ["rev-parse", "origin/dev"])).trim()
        } catch {
            return null
        }
    }
}

/** The evidence folder of a look: `--out`, else `<app root>/.starciwork/evidence/look/<stamp>-<env>`, which git ignores. */
const evidenceDir = (root: string, out: string | undefined, cwd: string, env: string, at: Date): string => {
    if (out !== undefined && out !== "") return resolve(cwd, out)
    const evidence = join(root, ".starciwork", "evidence")
    mkdirSync(evidence, { recursive: true })
    const ignore = join(evidence, ".gitignore")
    if (!existsSync(ignore)) writeFileSync(ignore, "# local look evidence (starci app look): shots are never source\n*\n")
    return join(evidence, "look", `${lookStamp(at)}-${env}`)
}

/**
 * `starci app look --env dev --paths /chat,/leads`: look at the RUNNING dev stack with real data (PROJECT-GALLERY-7 step 2b). It never
 * starts a server: it checks the declared web and api answer, takes a machine-wide shoot slot, signs in as the app's seed owner through the
 * app's api (the password read from the app's secret custody, never printed), opens every route at every width in the installed Chrome
 * with that session, full-page, and writes the PNGs plus `index.json` (route, width, time, the dev sha) into the lane's evidence bundle.
 */
export const appLookVerb = defineVerb({
    path: ["app", "look"],
    summary: "look at the running dev stack with real data (PROJECT-GALLERY-7 step 2b): sign in as the app's seed owner (gallery/look.json; the password from custody, never printed), shoot every --paths route at 1440 and 390 in the installed Chrome under a shoot slot, write PNGs and index.json (route, width, time, dev sha) into .starciwork/evidence/look/ or --out; never starts a server",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-look@1",
    flags: {
        app: { kind: "string", summary: "the app: its hfs.json project or folder name, or its folder (default: the app around the working folder)" },
        env: { kind: "string", summary: "the environment of gallery/look.json to look at (default dev)" },
        paths: { kind: "list", summary: "the routes the change reaches, comma-separated or repeated (/chat,/leads); prefixed by the workspace route when a workspace is chosen", required: true },
        workspace: { kind: "string", summary: "the workspace id (default: the declared demo workspace; none: paths are taken as typed)" },
        widths: { kind: "list", summary: "viewport widths, comma-separated (default 1440,390)" },
        out: { kind: "string", summary: "the folder for the PNGs and index.json (default: <app>/.starciwork/evidence/look/<stamp>-<env>)" },
        settle: { kind: "string", summary: "milliseconds to wait after the page settles, before the shot (default 1500)" },
        lane: { kind: "string", summary: "the lane that holds the shoot slot (default: STARCI_LANE, else the branch lane/<lane>)" },
        wait: { kind: "string", summary: "seconds to wait for a shoot slot before SLOT_BUSY (default: until one frees)" },
        dir: { kind: "string", summary: "the lanes folder, where foreign slot lock files of older copies are honoured too (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml, else <harness state>/slots); the slots themselves are rows of machine.sqlite, the same from every folder" },
    },
    run: async (context, flags) => {
        const say = context.progress
        const env = flags.env ?? "dev"
        const root = appRoot(context.cwd, flags.app)
        const configFile = join(root, ...LOOK_CONFIG.split("/"))
        const settings = lookEnvOf(existsSync(configFile) ? readFileSync(configFile, "utf8") : null, env)
        const workspace = flags.workspace === "none" ? undefined : (flags.workspace ?? settings.workspace?.default)
        const plan = lookPlan(settings, listValues(flags.paths), widthsOf(flags.widths), workspace)
        const settle = positiveInt("settle", flags.settle) ?? 1500
        const lane = await laneHolder(context.cwd, flags.lane)
        for (const url of [settings.web, settings.api]) if (!(await reachable(url))) throw new Refusal("LOOK_DEV_DOWN", `${url} does not answer: app look looks at the running ${env} stack and never starts it (starci dev sync --execute in the app's dev checkout)`)
        const started = new Date()
        const out = evidenceDir(root, flags.out, context.cwd, env, started)
        mkdirSync(out, { recursive: true })
        const devSha = await devShaOf(root)
        const chromium = await loadChromium(root)
        const rules = loadSlotRules()
        const slots = slotRoot(flags.dir, rules)
        const shots = await withSlot(slots, rules, "shoot", lane, { waitSeconds: waitSeconds(flags.wait), say }, async (taken) => {
            say(`shoot slot ${String(taken.n)} held by ${lane}`)
            const browser = await chromium.launch({ channel: "chrome", headless: true })
            const results: LookIndexShot[] = []
            try {
                for (const width of [...new Set(plan.map((shot) => shot.width))]) {
                    // One context per width, signed in afresh: the app may rotate its refresh cookie, so two contexts never share one session.
                    const browserContext = await browser.newContext({ viewport: { width, height: HEIGHTS[width] ?? 900 }, deviceScaleFactor: 1, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" })
                    try {
                        await browserContext.addCookies(await signIn(root, env, settings))
                        const page = await browserContext.newPage()
                        for (const shot of plan.filter((each) => each.width === width)) {
                            let status: number | null = null
                            let problem: string | null = null
                            try {
                                status = (await page.goto(shot.url, { waitUntil: "domcontentloaded", timeout: 60_000 }))?.status() ?? null
                                await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined)
                                await page.addStyleTag({ content: "nextjs-portal{display:none !important}" }).catch(() => undefined)
                                await page.waitForTimeout(settle)
                                await page.screenshot({ path: join(out, shot.file), fullPage: true })
                            } catch (error: unknown) {
                                problem = error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : "failed"
                            }
                            const landed = page.url()
                            if (problem === null && signedOut(landed)) problem = `landed on the sign-in page (${landed}): the session did not hold`
                            if (problem === null && status !== null && status >= 400) problem = `answered ${String(status)}`
                            say(`${shot.route} @${String(width)}: ${problem ?? shot.file}`)
                            results.push({ route: shot.route, url: shot.url, width, file: shot.file, time: new Date().toISOString(), landed, status, problem })
                        }
                    } finally {
                        await browserContext.close()
                    }
                }
            } finally {
                await browser.close()
            }
            return results
        })
        const index = lookIndex({ app: projectOf(root) ?? basename(root), env, web: settings.web, workspace: workspace ?? null, devSha, startedAt: started.toISOString() }, shots)
        writeFileSync(join(out, "index.json"), `${JSON.stringify(index, null, 2)}\n`)
        const failed = shots.filter((shot) => shot.problem !== null)
        return {
            data: { out, index },
            message: `${String(shots.length - failed.length)}/${String(shots.length)} shots of ${index.app} ${env} at ${devSha?.slice(0, 9) ?? "unknown sha"} in ${out}${failed.map((shot) => `\n  ${shot.route} @${String(shot.width)}: ${shot.problem ?? ""}`).join("")}`,
            exitCode: failed.length === 0 ? 0 : 1,
        }
    },
})
