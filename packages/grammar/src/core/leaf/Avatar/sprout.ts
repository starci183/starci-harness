import { Avatar as DiceAvatar, Style } from "@dicebear/core"
import sprouts from "@dicebear/styles/sprouts.json" with { type: "json" }

const sproutStyle = new Style(sprouts)
const sproutCache = new Map<string, string>()

/** The Sprouts image of a seed (the avatar's `seed`, else its name), drawn locally and cached: the same seed always gives the same image. */
export const avatarSproutUri = (name: string, seed?: string): string => {
    const key = seed ?? name
    const cached = sproutCache.get(key)
    if (cached !== undefined) return cached
    const uri = new DiceAvatar(sproutStyle, { seed: key, borderRadius: 0, idRandomization: false }).toDataUri()
    sproutCache.set(key, uri)
    return uri
}
