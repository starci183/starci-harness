import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"

/*
 * A headless Chromium driven over the DevTools protocol with Node's own WebSocket: the harness adds no browser package. The
 * browser is the one installed on the host (Chrome, Edge or Chromium), or the binary STARCI_BROWSER / --browser names.
 */

/** The environment variable that names the browser binary. */
export const BROWSER_ENV = "STARCI_BROWSER"

const CANDIDATES: Readonly<Record<string, readonly string[]>> = {
    win32: [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    ],
    darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
    linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/microsoft-edge"],
}

/** The browser binary: the flag, else STARCI_BROWSER, else the first installed candidate of this platform. */
export const findBrowser = (flag: string | undefined): string => {
    const named = flag ?? process.env[BROWSER_ENV]
    if (named !== undefined && named !== "") {
        if (!existsSync(named)) throw new Refusal("DNA_NO_BROWSER", `the browser ${named} does not exist`)
        return named
    }
    const found = (CANDIDATES[process.platform] ?? []).find((candidate) => existsSync(candidate))
    if (found === undefined) throw new Refusal("DNA_NO_BROWSER", `no Chromium browser is installed here; name one with --browser or ${BROWSER_ENV}`)
    return found
}

interface Pending {
    readonly resolve: (value: unknown) => void
    readonly reject: (error: Error) => void
}

interface ProtocolMessage {
    readonly id?: number
    readonly method?: string
    readonly sessionId?: string
    readonly result?: unknown
    readonly error?: { readonly message: string }
}

/** The keys the driver presses: the code and the virtual key code the protocol wants. */
const KEYS: Readonly<Record<string, { readonly code: string; readonly keyCode: number }>> = {
    Enter: { code: "Enter", keyCode: 13 },
    Escape: { code: "Escape", keyCode: 27 },
    Tab: { code: "Tab", keyCode: 9 },
    " ": { code: "Space", keyCode: 32 },
    Space: { code: "Space", keyCode: 32 },
    ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
    ArrowUp: { code: "ArrowUp", keyCode: 38 },
    ArrowRight: { code: "ArrowRight", keyCode: 39 },
    ArrowDown: { code: "ArrowDown", keyCode: 40 },
    Home: { code: "Home", keyCode: 36 },
    End: { code: "End", keyCode: 35 },
}

const LAUNCH_TIMEOUT_MS = 20_000
const CALL_TIMEOUT_MS = 30_000

/** One headless browser and one page in it. */
export class HeadlessPage {
    private readonly pending = new Map<number, Pending>()
    private readonly waiters: { readonly method: string; readonly resolve: () => void }[] = []
    private next = 1
    private session = ""

    private constructor(
        private readonly child: ChildProcess,
        private readonly socket: WebSocket,
        private readonly profile: string,
    ) {
        socket.addEventListener("message", (event: MessageEvent) => {
            this.receive(String(event.data))
        })
    }

    /** Starts the browser headless and opens one blank page at a fixed desktop viewport. */
    public static async launch(binary: string, viewport: { readonly width: number; readonly height: number }): Promise<HeadlessPage> {
        const profile = mkdtempSync(join(tmpdir(), "starci-dna-"))
        const args = [
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--hide-scrollbars",
            "--disable-breakpad",
            "--disable-crash-reporter",
            "--disable-background-networking",
            "--disable-component-update",
            "--remote-debugging-port=0",
            `--user-data-dir=${profile}`,
            ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
            "about:blank",
        ]
        const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] })
        const endpoint = await new Promise<string>((resolve, reject) => {
            let seen = ""
            const timer = setTimeout(() => {
                reject(new Refusal("DNA_BROWSER_START", `${binary} printed no DevTools endpoint in ${String(LAUNCH_TIMEOUT_MS / 1000)}s`))
            }, LAUNCH_TIMEOUT_MS)
            child.on("error", (error) => {
                clearTimeout(timer)
                reject(new Refusal("DNA_BROWSER_START", `${binary} did not start: ${error.message}`))
            })
            child.stderr.on("data", (chunk: Buffer) => {
                seen += chunk.toString("utf8")
                const match = /DevTools listening on (ws:\/\/\S+)/.exec(seen)
                if (match?.[1] !== undefined) {
                    clearTimeout(timer)
                    resolve(match[1])
                }
            })
        })
        const socket = new WebSocket(endpoint)
        await new Promise<void>((resolve, reject) => {
            socket.addEventListener("open", () => {
                resolve()
            })
            socket.addEventListener("error", () => {
                reject(new Refusal("DNA_BROWSER_START", `could not connect to ${endpoint}`))
            })
        })
        const page = new HeadlessPage(child, socket, profile)
        const target = (await page.call("Target.createTarget", { url: "about:blank" })) as { targetId: string }
        const attached = (await page.call("Target.attachToTarget", { targetId: target.targetId, flatten: true })) as { sessionId: string }
        page.session = attached.sessionId
        await page.call("Page.enable", {})
        await page.call("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false })
        return page
    }

    private receive(text: string): void {
        const message = JSON.parse(text) as ProtocolMessage
        if (message.id !== undefined) {
            const waiting = this.pending.get(message.id)
            if (waiting === undefined) return
            this.pending.delete(message.id)
            if (message.error === undefined) waiting.resolve(message.result)
            else waiting.reject(new Error(message.error.message))
            return
        }
        if (message.method === undefined) return
        for (const waiter of this.waiters.filter((item) => item.method === message.method)) {
            this.waiters.splice(this.waiters.indexOf(waiter), 1)
            waiter.resolve()
        }
    }

    private call(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
        const id = this.next++
        const body = this.session === "" ? { id, method, params } : { id, method, params, sessionId: this.session }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id)
                reject(new Refusal("DNA_BROWSER_TIMEOUT", `the browser did not answer ${method} in ${String(CALL_TIMEOUT_MS / 1000)}s`))
            }, CALL_TIMEOUT_MS)
            this.pending.set(id, {
                resolve: (value) => {
                    clearTimeout(timer)
                    resolve(value)
                },
                reject: (error) => {
                    clearTimeout(timer)
                    reject(error)
                },
            })
            this.socket.send(JSON.stringify(body))
        })
    }

    private event(method: string, timeoutMs: number): Promise<boolean> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                const index = this.waiters.findIndex((item) => item.method === method)
                if (index >= 0) this.waiters.splice(index, 1)
                resolve(false)
            }, timeoutMs)
            this.waiters.push({
                method,
                resolve: () => {
                    clearTimeout(timer)
                    resolve(true)
                },
            })
        })
    }

    /** Opens a URL and waits for its load event; false when the page never loaded in time. */
    public async open(url: string, timeoutMs: number): Promise<boolean> {
        const loaded = this.event("Page.loadEventFired", timeoutMs)
        const answer = (await this.call("Page.navigate", { url })) as { errorText?: string }
        if (answer.errorText !== undefined) throw new Refusal("DNA_PAGE_UNREACHABLE", `${url}: ${answer.errorText}`)
        return loaded
    }

    /**
     * Sets the viewport the page lays out in. `touch` makes the page a phone to its own media queries (pointer coarse, hover none),
     * which is how a law about a coarse pointer is measured; `scale` is the device scale factor of a screenshot.
     */
    public async viewport(size: { readonly width: number; readonly height: number; readonly touch?: boolean; readonly scale?: number }): Promise<void> {
        const touch = size.touch === true
        await this.call("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: size.scale ?? 1, mobile: touch })
        await this.call("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: 1 })
    }

    /** Emulates media features: colour scheme, forced colours, reduced motion. An absent feature is reset to the browser's own. */
    public async media(features: { readonly dark?: boolean; readonly forcedColors?: boolean; readonly reducedMotion?: boolean }): Promise<void> {
        await this.call("Emulation.setEmulatedMedia", {
            features: [
                { name: "prefers-color-scheme", value: features.dark === true ? "dark" : "light" },
                { name: "forced-colors", value: features.forcedColors === true ? "active" : "none" },
                { name: "prefers-reduced-motion", value: features.reducedMotion === true ? "reduce" : "no-preference" },
            ],
        })
    }

    /** One key press, with the modifiers held (alt 1, ctrl 2, meta 4, shift 8). */
    public async key(key: string, modifiers = 0): Promise<void> {
        const known = KEYS[key]
        const description = known ?? { code: key.length === 1 ? `Key${key.toUpperCase()}` : key, keyCode: key.length === 1 ? key.toUpperCase().codePointAt(0) : 0 }
        const text = key === "Enter" ? String.fromCodePoint(13) : key.length === 1 ? key : undefined
        const base = { key, code: description.code, windowsVirtualKeyCode: description.keyCode, nativeVirtualKeyCode: description.keyCode, modifiers }
        await this.call("Input.dispatchKeyEvent", { type: text === undefined ? "rawKeyDown" : "keyDown", ...base, ...(text === undefined ? {} : { text }) })
        await this.call("Input.dispatchKeyEvent", { type: "keyUp", ...base })
    }

    /** One pointer event at a point of the page: moved, pressed or released with the left button. */
    public async pointer(type: "mouseMoved" | "mousePressed" | "mouseReleased", x: number, y: number): Promise<void> {
        await this.call("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 })
    }

    /**
     * An image of the page as it is (png, or webp for a contact sheet). `full` captures the whole document height beyond the viewport,
     * at most `maxHeight` CSS px of it, so a very long page never outgrows the browser's texture limit.
     */
    public async screenshot(full: boolean, format: "png" | "webp" = "png", maxHeight = 16_000): Promise<Buffer> {
        const size = full ? ((await this.evaluate("({ width: document.documentElement.clientWidth, height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) })")) as { width: number; height: number }) : null
        const clip = size === null ? {} : { clip: { x: 0, y: 0, width: size.width, height: Math.min(size.height, maxHeight), scale: 1 } }
        const answer = (await this.call("Page.captureScreenshot", { format, ...(format === "webp" ? { quality: 72 } : {}), captureBeyondViewport: full, fromSurface: true, ...clip })) as { data: string }
        return Buffer.from(answer.data, "base64")
    }

    /** Types text into the focused element, as an input method would (a field's value is never written by script). */
    public async insertText(text: string): Promise<void> {
        await this.call("Input.insertText", { text })
    }

    /** Runs a script in every document the page opens, before the page's own scripts. */
    public async onNewDocument(source: string): Promise<void> {
        await this.call("Page.addScriptToEvaluateOnNewDocument", { source })
    }

    /** Evaluates an expression in the page, awaiting a promise, and returns its value as JSON. */
    public async evaluate(expression: string): Promise<unknown> {
        const answer = (await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })) as {
            result?: { value?: unknown }
            exceptionDetails?: { text?: string; exception?: { description?: string } }
        }
        if (answer.exceptionDetails !== undefined) {
            throw new Refusal("DNA_PAGE_SCRIPT", answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text ?? "the page script threw")
        }
        return answer.result?.value
    }

    /** Closes the browser and removes its throwaway profile. */
    public async close(): Promise<void> {
        this.session = ""
        const exited = new Promise<void>((resolve) => {
            if (this.child.exitCode !== null) resolve()
            this.child.once("exit", () => {
                resolve()
            })
            setTimeout(() => {
                this.child.kill()
                resolve()
            }, 5_000).unref()
        })
        try {
            await this.call("Browser.close", {})
        } catch {
            this.child.kill()
        }
        this.socket.close()
        await exited
        this.child.stderr?.destroy()
        this.child.unref()
        rmSync(this.profile, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 })
    }
}
