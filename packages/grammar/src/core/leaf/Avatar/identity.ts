import { STARCI_CORE_DNA } from "../../dna.js"

/**
 * The identity of an avatar with no image, pure and dependency free: the two initials, the colour a name always gets, and how a group tiles its members.
 */

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
const MARK = /\p{M}/u

/** One character with the combining marks that follow it, so a diacritic stays on its letter. */
const clusters = (word: string): string[] => {
    const out: string[] = []
    for (const char of Array.from(word.normalize("NFC"))) {
        if (MARK.test(char) && out.length > 0) out[out.length - 1] += char
        else out.push(char)
    }
    return out
}

/** The first letter or digit of a word with its diacritics, or "" for a word of punctuation only. */
const firstLetter = (word: string): string => clusters(word).find((cluster) => LETTER_OR_DIGIT.test(cluster)) ?? ""

/**
 * THE INITIALS RULE. Two letters, uppercased, each keeping its diacritic ("Ê", "Đ", "Ư").
 * - Two or more words: the first letter of the FIRST word plus the first letter of the LAST word. A Vietnamese name is written family name first and
 *   given name last, so "Nguyễn Văn An" is "NA" (family and given), "Đỗ Thị Hoa" is "ĐH", "Lê Quang Đạt" is "LĐ"; a western "Claude Agent" is "CA".
 *   The middle words never count. Words with no letter or digit ("-", "&") are skipped.
 * - One word: its first two letters ("Nivo" is "NI", "Ánh" is "ÁN"); a one-letter word is one letter.
 * - Nothing to read: "?".
 * Combining marks (a decomposed "e" + U+0302) are folded into the letter first, so a name typed either way gives the same initials.
 */
export const avatarInitials = (name: string): string => {
    const words = name.trim().split(/\s+/).filter((word) => firstLetter(word) !== "")
    if (words.length === 0) return "?"
    const first = words[0] ?? ""
    const last = words[words.length - 1] ?? ""
    const letters = words.length >= 2
        ? [firstLetter(first), firstLetter(last)]
        : clusters(first).filter((cluster) => LETTER_OR_DIGIT.test(cluster)).slice(0, 2)
    return letters.join("").toUpperCase()
}

/**
 * The fixed palette of the avatar's solid background: Grammar's own theme tones, as hex (`STARCI_CORE_DNA.avatar.palette`, because the image is an SVG in an
 * `<img>` and cannot read a CSS variable). The letters are white or black, whichever has the contrast; every entry passes 4.5:1 with one of them.
 */
export const AVATAR_PALETTE: ReadonlyArray<{ readonly token: string; readonly mode: "light" | "dark"; readonly hex: string }> = STARCI_CORE_DNA.avatar.palette

/** WCAG relative luminance of a `#rrggbb` colour. */
const luminance = (hex: string): number => {
    const channel = (offset: number): number => {
        const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** WCAG contrast ratio of two `#rrggbb` colours. */
export const avatarContrast = (a: string, b: string): number => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
    return (high + 0.05) / (low + 0.05)
}

/** The two letter inks: white on a dark tone, a dark tint on a light one. */
export const AVATAR_INKS = STARCI_CORE_DNA.avatar.inks

/**
 * The letter colour of one palette entry, chosen here and passed to the image, never left to the style's own pick (DiceBear's `contrastTo` put dark
 * letters on dark plates): whichever ink has the higher contrast with the tone.
 */
export const avatarInk = (hex: string): string =>
    avatarContrast(hex, AVATAR_INKS.light) >= avatarContrast(hex, AVATAR_INKS.dark) ? AVATAR_INKS.light : AVATAR_INKS.dark

/** 32-bit FNV-1a over the NFC, case-folded key: the same text always lands on the same entry, on any machine. */
const hash = (key: string): number => {
    let h = 0x811c9dc5
    for (const char of key.normalize("NFC").toLowerCase()) {
        h ^= char.codePointAt(0) ?? 0
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return h
}

/** The palette index of an identity: its `seed` (a stable id) when it has one, else its name. */
export const avatarHue = (key: string): number => hash(key.trim()) % AVATAR_PALETTE.length

/** What one cell of a group tile holds: a member (by index) or the "+N" of those that do not fit. */
export type AvatarTile = { readonly kind: "member"; readonly index: number } | { readonly kind: "more"; readonly count: number }

/**
 * THE OVERFLOW RULE, shared by both layouts: a group shows at most `max` slots. When the members fit they all show; when they do not, `max - 1` members show
 * and the last slot is "+N", N being every member left out (`total - (max - 1)`), so the slots never exceed `max`. `max` is at least 2 (one member and the "+N").
 */
export const avatarGroupSlots = (total: number, max: number): { readonly shown: number; readonly hidden: number } => {
    const slots = Math.max(2, Math.floor(max))
    if (total <= slots) return { shown: Math.max(0, total), hidden: 0 }
    return { shown: slots - 1, hidden: total - (slots - 1) }
}

/** The most tiles the Zalo-style grid holds: a 2 by 2. */
export const AVATAR_GRID_CAPACITY = 4

/**
 * How a Zalo-style group tiles `total` members inside one avatar: one member fills it, two are halves, three are one half and two quarters
 * (the first on top, the other two below), four are four quarters, and past `max` (4 by default, never more than the 2 by 2) the last tile is "+N" for the members that
 * do not fit, beside `max - 1` members (N = total - (max - 1); 5 members: three and "+2").
 */
export const avatarGroupTiles = (total: number, max: number = AVATAR_GRID_CAPACITY): ReadonlyArray<AvatarTile> => {
    if (total <= 0) return []
    const { shown, hidden } = avatarGroupSlots(total, Math.min(max, AVATAR_GRID_CAPACITY))
    const tiles: AvatarTile[] = Array.from({ length: shown }, (_, index) => ({ kind: "member", index }))
    return hidden === 0 ? tiles : [...tiles, { kind: "more", count: hidden }]
}

/** Where a member of the Zalo-style cluster stands in its square: the four corners of the 2 by 2, or the middle of the foot for a third member. `whole` is a lone member. */
export type AvatarClusterSlot = "whole" | "top-start" | "top-end" | "bottom-start" | "bottom-end" | "bottom-centre"

/** What one cell of the cluster holds: a member (by index) or the count of every member of the group. */
export type AvatarClusterCell = { readonly slot: AvatarClusterSlot } & (
    | { readonly kind: "member"; readonly index: number }
    | { readonly kind: "count"; readonly total: number; readonly hidden: number }
)

/**
 * THE CLUSTER (owner 2026-11-26, "nhóm k cần hình tròn"): a group is NOT one big circle cut into tiles; it is small round member avatars set close in a 2 by 2
 * square, the way Zalo draws a group. One member is the whole avatar. Two stand on the diagonal (the first top start, the second bottom end). Three are two on
 * top and one in the middle of the foot. Four or more are three members (top start, top end, bottom start) and, bottom end, a count cell that reads the number of
 * members of the whole group (4, 5, 29), `hidden` of which are not drawn.
 */
export const avatarClusterCells = (total: number): ReadonlyArray<AvatarClusterCell> => {
    if (total <= 0) return []
    if (total === 1) return [{ kind: "member", index: 0, slot: "whole" }]
    if (total === 2) return [{ kind: "member", index: 0, slot: "top-start" }, { kind: "member", index: 1, slot: "bottom-end" }]
    if (total === 3) return [{ kind: "member", index: 0, slot: "top-start" }, { kind: "member", index: 1, slot: "top-end" }, { kind: "member", index: 2, slot: "bottom-centre" }]
    return [
        { kind: "member", index: 0, slot: "top-start" },
        { kind: "member", index: 1, slot: "top-end" },
        { kind: "member", index: 2, slot: "bottom-start" },
        { kind: "count", total, hidden: total - 3, slot: "bottom-end" },
    ]
}
