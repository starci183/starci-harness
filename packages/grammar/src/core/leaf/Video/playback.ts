import type { MediaSourceRef } from "../Image/mediaSource.js"

/**
 * The container or manifest a source is: a file the browser plays itself (`video/mp4`, `video/webm`, `video/ogg`), an HLS
 * playlist (`.m3u8`) or an MPEG-DASH manifest (`.mpd`).
 */
export type VideoSourceType =
    | "video/mp4"
    | "video/webm"
    | "video/ogg"
    | "application/vnd.apple.mpegurl"
    | "application/x-mpegURL"
    | "application/dash+xml"

export type VideoSource = MediaSourceRef & { readonly type: VideoSourceType }

/** How a picked source plays: by the element itself, by the platform's own HLS, by hls.js, or by dash.js. */
export type VideoPlayback = "native" | "native-hls" | "hls.js" | "dash.js"

/** What the browser can do, read once from a `video` element. Injected, so the choice is a pure function. */
export type VideoSupport = {
    /** `HTMLMediaElement.canPlayType`: the empty string means no. */
    readonly canPlayType: (type: string) => string
    /** Media Source Extensions: what hls.js and dash.js need to feed the element. */
    readonly hasMediaSource: boolean
}

const HLS_TYPES: ReadonlySet<string> = new Set(["application/vnd.apple.mpegurl", "application/x-mpegURL"])
const DASH_TYPE = "application/dash+xml"

/** How one source would play on this browser, or `null` when it cannot. */
export const playbackOf = (type: VideoSourceType, support: VideoSupport): VideoPlayback | null => {
    if (HLS_TYPES.has(type)) {
        if (support.canPlayType("application/vnd.apple.mpegurl") !== "") return "native-hls"
        return support.hasMediaSource ? "hls.js" : null
    }
    if (type === DASH_TYPE) return support.hasMediaSource ? "dash.js" : null
    return support.canPlayType(type) === "" ? null : "native"
}

/**
 * The first source, in the author's order, the browser can play. The author's order is the preference (the lightest or
 * most compatible file first); the platform's own playback beats a script player of the same entry because a source is
 * judged one by one, in order.
 */
export const pickVideoSource = <S extends { readonly type: VideoSourceType }>(sources: readonly S[], support: VideoSupport): { readonly source: S; readonly playback: VideoPlayback } | null => {
    for (const source of sources) {
        const playback = playbackOf(source.type, support)
        if (playback !== null) return { source, playback }
    }
    return null
}

/** The support of this browser, read from a throwaway element; the server has none. */
export const readVideoSupport = (): VideoSupport => {
    const probe = document.createElement("video")
    const win = window as unknown as { readonly MediaSource?: unknown; readonly ManagedMediaSource?: unknown }
    return {
        canPlayType: (type) => probe.canPlayType(type),
        hasMediaSource: win.MediaSource !== undefined || win.ManagedMediaSource !== undefined,
    }
}

/** What stops a script player: it is told to stop, and each player says so its own way. */
export type VideoPlayerHandle = { readonly destroy: () => void }

/**
 * Attaches hls.js or dash.js to a `video` element, loading the library only now, by dynamic `import()`: an app that never
 * plays a stream ships its chunk and never fetches it. `onFatal` is called once when the stream cannot play.
 */
export const attachScriptPlayer = async (playback: "hls.js" | "dash.js", video: HTMLVideoElement, url: string, autoPlay: boolean, onFatal: () => void): Promise<VideoPlayerHandle | null> => {
    if (playback === "hls.js") {
        const { default: Hls } = await import("hls.js")
        if (!Hls.isSupported()) return null
        const hls = new Hls()
        hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) onFatal()
        })
        hls.loadSource(url)
        hls.attachMedia(video)
        return { destroy: () => hls.destroy() }
    }
    const dash = await import("dashjs")
    const player = dash.MediaPlayer().create()
    player.on(dash.MediaPlayer.events.ERROR, onFatal)
    player.initialize(video, url, autoPlay)
    return { destroy: () => player.destroy() }
}
