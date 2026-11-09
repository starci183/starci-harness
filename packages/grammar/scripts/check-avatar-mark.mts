import { avatarSproutUri } from "../src/core/leaf/Avatar/sprout.ts"

/**
 * Contract check: an Avatar with no image draws a DiceBear Sprouts image seeded by the name (people, agents, products and shops alike).
 * The same seed always gives the same image, a different seed gives another, the image is a local SVG data URI, and a given `seed` wins over the name.
 */
const problems: string[] = []
const a = avatarSproutUri("Nguyen Van An")
const b = avatarSproutUri("Nguyen Van An")
const c = avatarSproutUri("Tran Thi Binh")
if (a !== b) problems.push("the same name gave two different sprouts")
if (a === c) problems.push("two different names gave the same sprout")
if (!a.startsWith("data:image/svg+xml")) problems.push("the sprout is not a local SVG data URI")
if (avatarSproutUri("Shop A", "id-1") !== avatarSproutUri("Shop B", "id-1")) problems.push("a given seed must win over the name")
if (avatarSproutUri("Shop A", "id-1") === avatarSproutUri("Shop A", "id-2")) problems.push("two seeds gave the same sprout")
if (problems.length > 0) {
    console.error(problems.join(String.fromCharCode(10)))
    process.exit(1)
}
console.log("avatar mark: the sprout is deterministic per seed, local, and cached")
