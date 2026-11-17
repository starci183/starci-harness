"use client"

import { withRegionGeometry } from "../../regionScope.js"
import { useEffect, useRef, useState } from "react"
import { Skeleton as HeroSkeleton } from "@heroui/react"
import { ExclamationTriangleIcon, NoSymbolIcon } from "@heroicons/react/24/outline"
import { assetSlotAttributes, type AssetSlotProps } from "../Image/assetSlot.js"
import { reportUnresolvedStatics, useMediaUrl, type MediaSourceRef } from "../Image/mediaSource.js"
import { attachScriptPlayer, pickVideoSource, readVideoSupport, type VideoPlayback, type VideoPlayerHandle, type VideoSource } from "./playback.js"
import type { NoChildren } from "../../tier.js"

export type { VideoPlayback, VideoSource, VideoSourceType, VideoSupport } from "./playback.js"
export { pickVideoSource, playbackOf } from "./playback.js"

export type VideoRatio = "16:9" | "9:16" | "1:1"
export type VideoStatus = "idle" | "loading" | "ready" | "error" | "unsupported"

/** A WebVTT resource timed to the media: captions (speech and relevant sounds) or subtitles (a translation of the speech). */
export type VideoTrack = MediaSourceRef & {
    readonly kind?: "captions" | "subtitles"
    /** BCP 47 language tag of the track's text; required for subtitles. */
    readonly srcLang?: string
    /** Human-readable track name shown in the browser's caption menu. */
    readonly label: string
    /** The track shown at start. At most one. */
    readonly isDefault?: boolean
}

/** The words the box says when the video cannot be shown; English by default, the app passes its own catalogue text. */
export type VideoLabels = {
    readonly error?: string
    readonly unsupported?: string
}

export type VideoProps = NoChildren & AssetSlotProps & {
    /** Accessible name of the player. */
    readonly title: string
    /**
     * The files of this video, in the order of preference: the first the browser can play is the one it loads. An MP4 or
     * WebM plays natively, an HLS playlist (`application/vnd.apple.mpegurl`) natively where the platform reads it and
     * through hls.js elsewhere, and an MPEG-DASH manifest (`application/dash+xml`) through dash.js.
     */
    readonly sources: readonly VideoSource[]
    readonly poster?: MediaSourceRef
    readonly ratio?: VideoRatio
    /** The browser's own controls. Default `true`; a background loop sets `false`. */
    readonly controls?: boolean
    /** WebVTT captions or subtitles; never a placeholder track. */
    readonly tracks?: readonly VideoTrack[]
    /** Starts playing on its own, always muted and inline (a browser refuses sound without a press), and not at all under reduced motion. */
    readonly autoPlay?: boolean
    readonly loop?: boolean
    /** `lazy` (the default) loads no stream until the box is near the viewport; `eager` loads it at once, for the first screen. */
    readonly loading?: "lazy" | "eager"
    /** Cross-origin tracks and streams need a CORS response; omission preserves ordinary media fetching. */
    readonly crossOrigin?: "anonymous" | "use-credentials"
    readonly labels?: VideoLabels
    /** Unresolved video (a first load of its record): the ready box under a shimmer. A region tells it. */
    readonly isLoading?: boolean
}

const DEFAULT_LABELS = { error: "This video could not be loaded.", unsupported: "This browser cannot play this video." } as const

/** Distance before the viewport at which a lazy video attaches its stream. */
const ATTACH_MARGIN_PX = 200
const ATTACH_MARGIN = `${ATTACH_MARGIN_PX}px`

/**
 * One element for every video the Grammar plays: MP4 and WebM natively, HLS natively where the platform reads it and by
 * hls.js elsewhere, MPEG-DASH by dash.js. The libraries are the Grammar's own dependencies, loaded by dynamic `import()`
 * only when a source needs them, never from a CDN.
 *
 * The box claims its ratio before anything loads and shows the poster; no stream is requested until the box is near the
 * viewport (an IntersectionObserver) unless `loading="eager"`. A shimmer stands over the poster until the first frame is
 * ready, and a neutral notice with the app's words stands in the box when the stream fails or no source can play.
 * `autoPlay` always means muted and inline, and is skipped under reduced motion.
 */
const VideoInner = ({
    title,
    sources,
    poster,
    ratio = "16:9",
    controls = true,
    tracks,
    autoPlay = false,
    loop = false,
    loading = "lazy",
    crossOrigin,
    labels,
    ...assetSlot
}: VideoProps) => {
    const urlOf = useMediaUrl()
    const frameRef = useRef<HTMLDivElement>(null)
    const videoRef = useRef<HTMLVideoElement>(null)
    const [isNear, setNear] = useState(loading === "eager")
    const [status, setStatus] = useState<VideoStatus>("idle")
    const [playback, setPlayback] = useState<VideoPlayback | null>(null)
    const words = { ...DEFAULT_LABELS, ...labels }
    const posterUrl = poster === undefined ? null : urlOf(poster)
    const resolved = sources.flatMap((source) => {
        const url = urlOf(source)
        return url === null ? [] : [{ type: source.type, url }]
    })
    const key = resolved.map((entry) => `${entry.type}@${entry.url}`).join("|")

    useEffect(() => {
        if (isNear) return
        const frame = frameRef.current
        if (frame === null || typeof IntersectionObserver === "undefined") {
            setNear(true)
            return
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setNear(true)
                observer.disconnect()
            }
        }, { rootMargin: ATTACH_MARGIN })
        observer.observe(frame)
        return () => observer.disconnect()
    }, [isNear])

    useEffect(() => {
        if (!isNear) return
        const video = videoRef.current
        if (video === null) return
        for (const source of sources) if (source.staticsKey !== undefined && urlOf(source) === null) reportUnresolvedStatics("Video", source)
        const picked = pickVideoSource(resolved, readVideoSupport())
        if (picked === null) {
            setPlayback(null)
            setStatus(resolved.length === 0 && sources.length > 0 ? "error" : "unsupported")
            return
        }
        setPlayback(picked.playback)
        setStatus("loading")
        let handle: VideoPlayerHandle | null = null
        let isStale = false
        const start = () => {
            if (!autoPlay || isStale || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
            video.muted = true
            void video.play().catch(() => undefined)
        }
        if (picked.playback === "native" || picked.playback === "native-hls") {
            video.src = picked.source.url
            video.load()
            start()
        } else {
            void attachScriptPlayer(picked.playback, video, picked.source.url, false, () => setStatus("error")).then((attached) => {
                if (attached === null) setStatus("unsupported")
                else if (isStale) attached.destroy()
                else {
                    handle = attached
                    start()
                }
            }, () => setStatus("error"))
        }
        return () => {
            isStale = true
            handle?.destroy()
            video.removeAttribute("src")
            video.load()
        }
    }, [isNear, key, autoPlay])

    const failed = status === "error" || status === "unsupported"
    return (
        <div
            ref={frameRef}
            className="starci-core-video-frame"
            data-component="Video"
            data-tier="leaf"
            data-grammar-video-ratio={ratio}
            data-grammar-video-status={status}
            data-grammar-video-attached={isNear ? "true" : "false"}
            {...(playback === null ? {} : { "data-grammar-video-playback": playback })}
            {...assetSlotAttributes(assetSlot)}
        >
            <video
                ref={videoRef}
                className="starci-core-video"
                aria-label={title}
                title={title}
                controls={controls}
                loop={loop}
                muted={autoPlay}
                playsInline
                preload={isNear ? "metadata" : "none"}
                {...(posterUrl === null ? {} : { poster: posterUrl })}
                {...(crossOrigin === undefined ? {} : { crossOrigin })}
                onLoadedData={() => setStatus("ready")}
                onError={() => setStatus("error")}
            >
                {tracks?.map((track) => {
                    const trackUrl = urlOf(track)
                    return trackUrl === null ? null : (
                        <track key={`${track.kind ?? "captions"}-${track.srcLang ?? ""}-${trackUrl}`} kind={track.kind ?? "captions"} src={trackUrl} label={track.label} {...(track.srcLang === undefined ? {} : { srcLang: track.srcLang })} {...(track.isDefault === true ? { default: true } : {})} />
                    )
                })}
            </video>
            {status === "loading" ? <HeroSkeleton animationType="shimmer" aria-hidden="true" className="starci-core-skeleton starci-core-video-skeleton" data-contract="STATE-2 MOTION-2" /> : null}
            {failed ? (
                <div className="starci-core-video-notice" role="status" data-grammar-video-notice={status}>
                    {status === "error" ? <ExclamationTriangleIcon className="starci-core-video-glyph" aria-hidden="true" focusable="false" /> : <NoSymbolIcon className="starci-core-video-glyph" aria-hidden="true" focusable="false" />}
                    <span className="starci-core-video-notice-text">{status === "error" ? words.error : words.unsupported}</span>
                </div>
            ) : null}
        </div>
    )
}

export const Video = withRegionGeometry(VideoInner)
