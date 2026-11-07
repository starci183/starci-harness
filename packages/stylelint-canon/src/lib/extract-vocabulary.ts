/**
 * Reads the token vocabulary out of the grammar package's own CSS, so the list the rules judge against is
 * derived from what the grammar ships and never typed by hand. `vocabulary.generated.ts` is this function's
 * output; the twin test recomputes it and fails when the two differ.
 *
 * A family token is any custom property under a family prefix (`--grammar-`, `--starci-core-`,
 * `--offset-pop-`): the grammar sets some of them from TypeScript, so a prefix is the honest boundary. The
 * un-prefixed tokens are the semantic layer the grammar declares (`--accent`, `--surface`, ...) plus the vendor
 * tokens it reads but does not declare (`--radius-md`, `--font-mono`).
 */
import fs from "node:fs"
import path from "node:path"
import { byCodeUnit } from "./order.ts"

/** The four namespaces the grammar owns. */
export const FAMILY_PREFIXES: readonly string[] = ["--grammar-", "--starci-core-", "--offset-pop-"]

/** The grammar CSS the vocabulary is read from, relative to the grammar package. */
export const GRAMMAR_CSS: readonly string[] = [
  "common/styles.css",
  "common/ramps.css",
  "common/components-forms.css",
  "common/components-navigation.css",
  "common/components-overlays.css",
  "core/styles.css",
  "offset-pop/styles.css",
  "offset-pop/components-navigation.css",
]

/** HeroUI's `variables.css` snapshot, relative to the package root: the theme an app sets. */
export const HEROUI_VARIABLES = "fixtures/heroui/variables.css"

/**
 * The status tones: the HeroUI status vocabulary. Each one is a solid tone (`--<tone>`, ink
 * `--<tone>-foreground`) and a SOFT PAIR, `--<tone>-soft` (the tint) and `--<tone>-soft-foreground` (the ink a status
 * shown as text, an icon or a dot uses), in light and in dark. HeroUI has the pairs for success, warning and danger;
 * it has none for info, so the vocabulary adds it here: this list is the one extension, and `extractVocabulary`
 * refuses a tone other than `info` whose solid pair HeroUI does not declare.
 */
export const STATUS_TONES: readonly string[] = ["success", "warning", "danger", "info"]

/** The soft-pair tokens of one tone. */
const softPairOf = (tone: string): string[] => [`--${tone}-soft`, `--${tone}-soft-foreground`, `--${tone}-soft-hover`]

const inFamily = (name: string): boolean => FAMILY_PREFIXES.some((prefix) => name.startsWith(prefix))

/** The width breakpoints (as `<n>rem`, ascending) the grammar's media queries use: the one scale app CSS may cite. */
function extractBreakpoints(texts: readonly string[]): string[] {
  const found = new Set<number>()
  for (const text of texts) {
    for (const media of text.matchAll(/@media([^{]*)\{/g)) {
      for (const width of (media[1] ?? "").matchAll(/(?:min|max)-width\s*:\s*([\d.]+)(?:rem|em)/g)) found.add(Number(width[1]))
    }
  }
  return [...found].sort((a, b) => a - b).map((value) => `${value}rem`)
}

/** `{ declared, vendor, breakpoints, statusTones }`: sorted un-prefixed names the grammar declares, and reads without declaring. */
/** The vocabulary the grammar CSS yields. */
export interface Vocabulary {
  declared: string[]
  vendor: string[]
  breakpoints: string[]
  statusTones: string[]
}

/** The custom properties a CSS text declares. */
const declaredIn = (text: string): string[] => [...text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)].map((match) => match[1] ?? "")

/** The theme tokens HeroUI declares, read from its `variables.css`. */
export const extractHeroTokens = (variablesCss: string): string[] => [...new Set(declaredIn(variablesCss))].sort(byCodeUnit)

export function extractVocabulary(grammarSrcDir: string, heroVariablesFile: string): Vocabulary {
  const declared = new Set<string>(extractHeroTokens(fs.readFileSync(heroVariablesFile, "utf8")))
  const hero = new Set(declared)
  const referenced = new Set<string>()
  const texts: string[] = []
  for (const file of GRAMMAR_CSS) {
    const text = fs.readFileSync(path.join(grammarSrcDir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
    texts.push(text)
    for (const name of declaredIn(text)) declared.add(name)
    for (const match of text.matchAll(/var\(\s*(--[\w-]+)/g)) referenced.add(match[1] ?? "")
  }
  for (const tone of STATUS_TONES) {
    if (tone !== "info") {
      for (const name of [`--${tone}`, `--${tone}-foreground`]) {
        if (!hero.has(name)) throw new Error(`STATUS_TONES lists ${tone}, but HeroUI does not declare ${name}`)
      }
    }
    for (const name of softPairOf(tone)) declared.add(name)
  }
  declared.add("--info")
  declared.add("--info-foreground")
  const own = [...declared].filter((name) => !inFamily(name)).sort(byCodeUnit)
  const vendor = [...referenced].filter((name) => !declared.has(name) && !inFamily(name)).sort(byCodeUnit)
  return { declared: own, vendor, breakpoints: extractBreakpoints(texts), statusTones: [...STATUS_TONES] }
}
