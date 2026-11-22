import { Avatar as DiceAvatar, Style } from "@dicebear/core"
import initials from "@dicebear/styles/initials.json" with { type: "json" }
import { AVATAR_INKS, AVATAR_PALETTE, avatarHue, avatarInitials, avatarInk } from "./identity.js"

/**
 * The avatar image, drawn locally by DiceBear's Initials style (CC0) from `@dicebear/core` and `@dicebear/styles`: two letters centred on a solid
 * background. No network: nothing is fetched and no name leaves the page. The letters are ours (the initials rule, diacritics kept), set in the style's
 * own text slot; the background is one entry of the Grammar palette, passed as the style's `backgroundColor` list, chosen from the seed (the stable
 * identity id, so a renamed member keeps their colour). The letter colour is chosen per tone by `avatarInk` and passed in: the style's own
 * `contrastTo` pick put dark letters on dark plates. DiceBear's attribution comment and
 * metadata (CC0, no attribution required) are dropped so the image carries no URL.
 */
const style = (text: string, ink: string) => {
    const letters = initials.components.letters
    const double = letters.variants.double.elements[0]
    return new Style({
        ...initials,
        colors: { ...initials.colors, text: { values: [ink] } },
        components: {
            ...initials.components,
            letters: {
                ...letters,
                variants: {
                    literal: {
                        elements: [{
                            ...double,
                            // Two wide capitals at the style's size of 50 run past the circle; 40 keeps both letters inside it.
                            attributes: { ...double?.attributes, "font-size": "40", dy: "14.2" },
                            children: [{ type: "text", value: text }],
                        }],
                    },
                },
            },
        },
    })
}

const cache = new Map<string, string>()

/** The SVG text of an avatar: `name` gives the letters, `seed` (else the name) the palette entry. */
export const avatarSvg = (name: string, seed?: string, text = avatarInitials(name)): string => {
    const entry = AVATAR_PALETTE[avatarHue(seed ?? name)]
    const svg = new DiceAvatar(style(text, entry === undefined ? AVATAR_INKS.light : avatarInk(entry.hex)), {
        seed: seed ?? name,
        borderRadius: 0,
        idRandomization: false,
        initialsVariant: "alt",
        lettersVariant: "literal",
        ...(entry === undefined ? {} : { backgroundColor: [entry.hex.replace("#", "")] }),
    }).toString()
    return svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<metadata[\s\S]*?<\/metadata>/g, "")
}

/** The same image as a data URI for an `<img>`, cached per name, seed and text. */
export const avatarDataUri = (name: string, seed?: string, text = avatarInitials(name)): string => {
    const key = `${seed ?? ""}\u0000${name}\u0000${text}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const uri = `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(name, seed, text))}`
    cache.set(key, uri)
    return uri
}
