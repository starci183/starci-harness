// The Vite side of the gallery: an app's whole gallery is one config file, `export default defineGallery({ app, locale, allowedHosts })`. The plugin reads the pages, the
// flows, the design canvas and the design board at build and dev time, serves the shots, the canvas frames and the board's frames, and mounts the gallery app that this
// package compiles.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwind from "@tailwindcss/postcss"
import { searchForWorkspaceRoot } from "vite"
import type { Plugin, UserConfig } from "vite"
import { BOARD_DIR } from "./board.ts"
import { galleryLocale } from "./labels.ts"
import { loadGallery, watchedPaths } from "./load.ts"
import type { Loaded } from "./load.ts"
import { buildModel } from "./model.ts"

export interface GalleryOptions {
    /** The app's name, shown in the title and the top bar. */
    readonly app: string
    /** The app's default locale (`vi` and `en` have a table; any other reads `en`). Default `en`. */
    readonly locale?: string
    /** The pages folder, relative to the gallery root. Default `pages`. */
    readonly pages?: string
    /** The design canvas folder, relative to the gallery root. Default `../.starcistacks/canvas`. */
    readonly canvas?: string
    /** The design board folder (board.yaml and one module per section, PROJECT-GALLERY-9), relative to the gallery root. Default `board`. */
    readonly board?: string
    /** The base URL of the dev app: a screen with a static route gets an "open on dev" link to `<devUrl><route>`. Omit when the app declares none. */
    readonly devUrl?: string
    /** The hosts the dev server answers besides localhost (the dev tunnel's gallery host). Default none. */
    readonly allowedHosts?: readonly string[]
}

const VIRTUAL_DATA = "virtual:starci-gallery/data"
const VIRTUAL_BOARD = "virtual:starci-gallery/board"
const ENTRY = "/@starci-gallery/main.js"
const BOARD_ENTRY = "/@starci-gallery/board-frame.js"
const BOARD_FRAME = "/__board/frame.html"
/** One frame of the board: the Grammar's stylesheet, the app's tokens and one section in one state, at the frame's own width (so the responsive rules see it). */
const BOARD_FRAME_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="${BOARD_ENTRY}"></script></body></html>`
const here = path.dirname(fileURLToPath(import.meta.url))
const MIME: Readonly<Record<string, string>> = { ".png": "image/png", ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8" }
const slashes = (file: string): string => file.split(path.sep).join("/")

/** The plugin: the data module, the app entry, the shots under `/__shots/`, the frames under `/__frames/` and the board's frames under `/__board/` (the dev server only). */
export function gallery(options: GalleryOptions): Plugin {
    let root = process.cwd()
    let loaded: Loaded | null = null
    const settings = () => ({ root, pages: options.pages ?? "pages", canvas: options.canvas ?? "../.starcistacks/canvas", board: options.board ?? BOARD_DIR })
    const current = (): Loaded => (loaded ??= loadGallery(settings()))
    const shotPath = (id: string, width: string): string => path.resolve(root, settings().pages, ...id.split("/"), `${width}.png`)
    const data = (): string => {
        const { raw, board } = current()
        const model = buildModel(raw)
        const json = JSON.stringify({ app: options.app, locale: galleryLocale(options.locale), devUrl: options.devUrl ?? null, model, board }, (key, value: unknown) => (key === "noteMarkdown" ? undefined : value))
        return `export default ${json}`
    }
    // The board's module: the app's token stylesheets (app-root relative, served through /@fs/) and one lazy import per section module that exists.
    const boardModule = (): string => {
        const { board } = current()
        if (board === null) return "export const sections = {}"
        const appRoot = path.resolve(root, "..")
        const boardRoot = path.resolve(root, settings().board)
        const tokens = board.tokens.map((file) => `import ${JSON.stringify(`/@fs/${slashes(path.resolve(appRoot, file)).replace(/^\//u, "")}`)}`)
        const loaders = board.sections
            .filter((section) => section.hasModule)
            .map((section) => `  ${JSON.stringify(section.id)}: () => import(${JSON.stringify(`/@fs/${slashes(path.join(boardRoot, ...section.id.split("/"))).replace(/^\//u, "")}.tsx`)}),`)
        return [...tokens, "export const sections = {", ...loaders, "}"].join("\n")
    }
    const asset = (url: string): { body: Buffer | string; type: string } | null => {
        const { frames, frameCss } = current()
        const frame = /^\/__frames\/([^/]+)$/u.exec(url)?.[1]
        if (frame === "frames.css") return { body: frameCss, type: MIME[".css"] ?? "" }
        const doc = frame === undefined ? undefined : frames.find((one) => one.file === frame)
        if (doc) return { body: doc.html, type: MIME[".html"] ?? "" }
        const shot = /^\/__shots\/([^/]+)\/([^/]+)\/(1440|390)\.png$/u.exec(url)
        if (shot?.[1] !== undefined && shot[2] !== undefined && shot[3] !== undefined) {
            const file = shotPath(`${shot[1]}/${shot[2]}`, shot[3])
            return fs.existsSync(file) ? { body: fs.readFileSync(file), type: MIME[".png"] ?? "" } : null
        }
        return null
    }
    return {
        name: "starci-gallery",
        configResolved(config) {
            root = config.root
        },
        resolveId(id) {
            if (id === VIRTUAL_DATA) return `\0${VIRTUAL_DATA}`
            if (id === VIRTUAL_BOARD) return `\0${VIRTUAL_BOARD}`
            if (id === ENTRY) return path.join(here, "app", "main.js")
            if (id === BOARD_ENTRY) return path.join(here, "app", "board-frame.js")
            return null
        },
        load(id) {
            if (id === `\0${VIRTUAL_BOARD}`) return boardModule()
            return id === `\0${VIRTUAL_DATA}` ? data() : null
        },
        configureServer(server) {
            const watched = watchedPaths(settings())
            server.watcher.add(watched)
            const reload = (file: string): void => {
                if (!watched.some((one) => path.resolve(file).startsWith(one)) || file.endsWith(".png")) return
                loaded = null
                for (const virtual of [VIRTUAL_DATA, VIRTUAL_BOARD]) {
                    const module = server.moduleGraph.getModuleById(`\0${virtual}`)
                    if (module) server.moduleGraph.invalidateModule(module)
                }
                server.ws.send({ type: "full-reload" })
            }
            for (const event of ["add", "change", "unlink"] as const) server.watcher.on(event, reload)
            server.middlewares.use((request, response, next) => {
                const url = (request.url ?? "").split("?")[0] ?? ""
                if (url === BOARD_FRAME) {
                    server.transformIndexHtml(request.url ?? BOARD_FRAME, BOARD_FRAME_HTML).then(
                        (html) => {
                            response.setHeader("content-type", MIME[".html"] ?? "")
                            response.setHeader("cache-control", "no-cache")
                            response.end(html)
                        },
                        (error: unknown) => { next(error) },
                    )
                    return
                }
                const found = url.startsWith("/__") ? asset(decodeURIComponent(url)) : null
                if (!found) { next(); return; }
                response.setHeader("content-type", found.type)
                response.setHeader("cache-control", "no-cache")
                response.end(found.body)
            })
        },
        generateBundle() {
            const { raw, frames, frameCss } = current()
            this.emitFile({ type: "asset", fileName: "__frames/frames.css", source: frameCss })
            for (const frame of frames) this.emitFile({ type: "asset", fileName: `__frames/${frame.file}`, source: frame.html })
            for (const [id, screen] of Object.entries(raw.screens)) {
                for (const width of screen.shots) this.emitFile({ type: "asset", fileName: `__shots/${id}/${width}.png`, source: fs.readFileSync(shotPath(id, width)) })
            }
        },
    }
}

/**
 * The whole Vite config of an app's gallery: the plugin, Tailwind for the Grammar's stylesheet, and the dev server the stack expects (the IPv4 loopback, PROJECT-GALLERY-1 item 4;
 * the shots are many and copied in bulk, so the PNGs are not watched: reload the page after adding some). A board section is a `.tsx` module of the app's gallery compiled with
 * the automatic JSX runtime, and the board reads the app's token stylesheets from the app root, one folder above the gallery root, so the server may serve that folder.
 */
export function defineGallery(options: GalleryOptions): UserConfig {
    return {
        plugins: [gallery(options)],
        css: { postcss: { plugins: [tailwind()] } },
        resolve: { dedupe: ["react", "react-dom"] },
        esbuild: { jsx: "automatic" },
        server: {
            host: "127.0.0.1",
            allowedHosts: [...(options.allowedHosts ?? [])],
            fs: { allow: [searchForWorkspaceRoot(process.cwd()), ".."] },
            watch: { ignored: ["**/*.png", "**/node_modules/**"], awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } },
        },
    }
}
