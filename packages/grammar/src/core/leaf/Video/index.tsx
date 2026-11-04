import { withRegionGeometry } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

/** A genuine WebVTT resource timed to the media, including speech and relevant non-speech audio. */
export type VideoCaptionsTrack = {
    readonly src: string
    /** BCP 47 language tag when the actual caption language is known. Captions may omit it. */
    readonly srcLang?: string
    /** Human-readable track name shown in the browser's caption menu. */
    readonly label: string
}

export type VideoProps = NoChildren & {
    readonly src: string
    /** Accessible name of the media player. */
    readonly title: string
    readonly poster?: string
    /** Null or omitted for media whose genuine caption resource is unavailable; never supply a placeholder. */
    readonly captions?: VideoCaptionsTrack | null
    /** Cross-origin tracks require an appropriate CORS response; omission preserves ordinary media fetching. */
    readonly crossOrigin?: "anonymous" | "use-credentials"
}

/** Native, user-controlled video with genuine captions when available; wrap in MediaFrame for a reserved aspect ratio. */
const VideoInner = ({ src, title, poster, captions, crossOrigin }: VideoProps) => (
    <video
        className="starci-core-video"
        data-component="Video"
        data-tier="leaf"
        controls
        playsInline
        preload="metadata"
        src={src}
        aria-label={title}
        title={title}
        {...(poster === undefined ? {} : { poster })}
        {...(crossOrigin === undefined ? {} : { crossOrigin })}
    >
        {captions == null ? null : (
            <track kind="captions" src={captions.src} label={captions.label} {...(captions.srcLang === undefined ? {} : { srcLang: captions.srcLang })} default />
        )}
    </video>
)

/** Native, user-controlled video with genuine captions when available; wrap in MediaFrame for a reserved aspect ratio. */
export const Video = withRegionGeometry(VideoInner)
