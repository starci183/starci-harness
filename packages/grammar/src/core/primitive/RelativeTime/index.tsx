"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import { Text, type TextTone } from "../Text/index.js"
import { getClockSnapshot, getServerClockSnapshot, subscribeClock } from "./clock.js"

export type RelativeTimeMode = "relative" | "countdown"
export type RelativeTimeFormat = "relative" | "digital"

type RelativeTimeBaseProps = {
    /** An RFC 3339 timestamp with an explicit Z or numeric timezone offset, never a local wall time. */
    readonly dateTime: string
    /** The application's active BCP 47 locale; never inferred from the server or browser. */
    readonly locale: string
    /** Copy shown once a countdown expires; replaces the time template as a whole. */
    readonly expiredLabel?: string
    /** Serializable copy around the formatted value, for example "Ends in {time}". */
    readonly template?: string
    /** Stable server/first-hydration and invalid-timestamp copy. Defaults to the canonical ISO timestamp when valid. */
    readonly fallback?: string
    readonly id?: string
    readonly size?: "xs" | "sm" | "md"
    readonly tone?: TextTone
}

export type RelativeTimeProps = RelativeTimeBaseProps & ({
    readonly mode?: "relative"
    readonly format?: never
} | {
    /** Countdown never overstates the remaining full unit and stops at zero. */
    readonly mode: "countdown"
    /** Digital countdowns show m:ss, or h:mm:ss when at least one hour remains. */
    readonly format?: RelativeTimeFormat
})

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["week", 7 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
]

/** Reject local wall time and impossible calendar dates without interrupting rendering. */
const parseInstant = (dateTime: string) => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.exec(dateTime)
    if (parts === null) return null
    const year = Number(parts[1])
    const month = Number(parts[2])
    const day = Number(parts[3])
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
    // Date.parse has a portable contract only for millisecond fractions and colon-separated offsets.
    const normalized = dateTime
        .replace(/\.(\d+)/, (_fraction, digits: string) => `.${digits.slice(0, 3).padEnd(3, "0")}`)
        .replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
    const value = Date.parse(normalized)
    if (day < 1 || day > daysInMonth || !Number.isFinite(value)) return null
    return { value, iso: new Date(value).toISOString() }
}

const relativeLabel = (seconds: number, mode: RelativeTimeMode, formatter: Intl.RelativeTimeFormat) => {
    const [unit, duration] = UNITS.find(([, length]) => Math.abs(seconds) >= length) ?? ["second", 1]
    const value = mode === "countdown" ? Math.floor(seconds / duration) : Math.round(seconds / duration)
    return formatter.format(value, unit)
}

const digitalLabel = (seconds: number) => {
    const absoluteSeconds = Math.abs(Math.trunc(seconds))
    const hours = Math.floor(absoluteSeconds / 3600)
    const minutes = Math.floor(absoluteSeconds / 60) % 60
    const remainder = String(absoluteSeconds % 60).padStart(2, "0")
    const time = hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`
    return seconds < 0 ? `-${time}` : time
}

/** Accessible live time; all leaves subscribe to the same clock and own no interval or wall-clock read. */
export const RelativeTime = ({ dateTime, locale, mode = "relative", format = "relative", expiredLabel, template = "{time}", fallback, id, size = "sm", tone = "muted" }: RelativeTimeProps) => {
    const instant = useMemo(() => parseInstant(dateTime), [dateTime])
    useEffect(() => {
        if (instant === null && process.env.NODE_ENV !== "production") {
            console.warn("RelativeTime dateTime must be a valid timezone-qualified timestamp; rendering fallback", dateTime)
        }
    }, [dateTime, instant])
    const formatter = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: mode === "countdown" ? "always" : "auto" }), [locale, mode])
    const now = useSyncExternalStore(subscribeClock, getClockSnapshot, getServerClockSnapshot)
    let label = fallback ?? instant?.iso ?? dateTime
    if (instant !== null && now !== null) {
        // Round the remaining seconds once, then choose and floor the displayed unit.
        const seconds = mode === "countdown" ? Math.ceil(Math.max(0, instant.value - now) / 1000) : (instant.value - now) / 1000
        const time = format === "digital" ? digitalLabel(seconds) : relativeLabel(seconds, mode, formatter)
        label = mode === "countdown" && seconds === 0 && expiredLabel !== undefined ? expiredLabel : template.replaceAll("{time}", time)
    }

    return (
        <time id={id} dateTime={instant?.iso} title={instant?.iso} data-tier="atom" data-component="RelativeTime" data-mode={mode} data-format={format}>
            <Text as="span" size={size} tone={tone}>{label}</Text>
        </time>
    )
}
