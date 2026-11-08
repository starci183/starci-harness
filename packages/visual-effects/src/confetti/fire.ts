import { playOverlay, pageHost, readRootToken } from "../core/overlay.ts"
import type { EffectHandle, EffectHost, EffectOptions, EffectSystem } from "../core/overlay.ts"
import { themeColors } from "../core/palette.ts"
import { advance, isVisible, launch, opacityOf } from "./physics.ts"
import type { ConfettiBurst, Piece } from "./physics.ts"
import { PRESETS } from "./presets.ts"
import type { ConfettiPreset } from "./presets.ts"

/** What one confetti call fires: a preset or the caller's own bursts, in the theme's colours or the caller's. */
export interface ConfettiOptions extends EffectOptions {
    /** A named shot (default `celebrate`); ignored when `bursts` is given. */
    readonly preset?: ConfettiPreset
    /** The caller's own shots, fired together. */
    readonly bursts?: readonly ConfettiBurst[]
    /** The colours, overriding the Grammar theme tokens. */
    readonly colors?: readonly string[]
}

/** Draws one piece: a tumbling strip, or a dot. */
const drawPiece = (context: CanvasRenderingContext2D, piece: Piece): void => {
    context.save()
    context.globalAlpha = opacityOf(piece)
    context.fillStyle = piece.color
    context.translate(piece.x, piece.y)
    context.rotate(piece.rotation)
    if (piece.shape === "dot") {
        context.beginPath()
        context.arc(0, 0, piece.width / 2, 0, Math.PI * 2)
        context.fill()
    } else {
        const height = Math.max(0.6, piece.height * Math.abs(Math.cos(piece.tilt)))
        context.fillRect(-piece.width / 2, -height / 2, piece.width, height)
    }
    context.restore()
}

/** The confetti as an overlay system: the pieces of every burst, launched at once, until the last one is gone. */
export const confettiSystem = (options: ConfettiOptions, host: EffectHost): EffectSystem => {
    const colors = options.colors ?? themeColors((name) => readRootToken(host, name))
    const bursts = options.bursts ?? PRESETS[options.preset ?? "celebrate"]
    const viewport = host.viewport()
    let pieces = bursts.flatMap((burst) => launch(burst, viewport, colors, host.random))
    return {
        advance: (seconds, now) => {
            for (const piece of pieces) advance(piece, seconds)
            pieces = pieces.filter((piece) => isVisible(piece, now))
        },
        draw: (context) => {
            for (const piece of pieces) drawPiece(context, piece)
        },
        isFinished: () => pieces.length === 0,
    }
}

/** Throws confetti over the page; it does nothing on the server or for a reader who asked for reduced motion. */
export const fireConfetti = (options: ConfettiOptions = {}, host: EffectHost | null = pageHost()): EffectHandle =>
    playOverlay("confetti", options, host, (live) => confettiSystem(options, live))
