/**
 * `starci/no-grammar-private-token` (HFS R364 `FE_STYLE_TOKEN_ONLY`): an app stylesheet never reads or writes a grammar's private
 * token (`--grammar-*`, `--starci-core-*`, `--offset-pop-*`). Those are the grammar's own plumbing between its parts and its
 * stylesheet: an app that reads one depends on a name the grammar may change, and one that writes one reaches inside a part. An app
 * themes through HeroUI's tokens in `brand.css` (`theme-layer-shape`) and composes through the grammar's props.
 */
import { makeRule } from "./lib/make-rule.ts"
import { FAMILY_PREFIXES } from "./lib/vocabulary.ts"

// The prefixes are plain custom-property names (letters and hyphens), so they need no escaping.
const READ = new RegExp(String.raw`var\(\s*(${FAMILY_PREFIXES.join("|")})[\w-]*`, "g")

export const noGrammarPrivateToken = makeRule(
  "no-grammar-private-token",
  {
    written: (name: string) => `\`${name}\` is a private token of the grammar and is written by an app stylesheet. Theme through HeroUI's tokens in \`brand.css\`; compose through the grammar's props.`,
    read: (name: string) => `\`${name}\` is a private token of the grammar and is read by an app stylesheet. It is the grammar's plumbing and may change; read HeroUI's tokens.`,
  },
  ({ root, report }) => {
    root.walkDecls((decl) => {
      if (FAMILY_PREFIXES.some((prefix) => decl.prop.startsWith(prefix))) report(decl, "written", [decl.prop], { word: decl.prop })
      for (const match of decl.value.matchAll(READ)) {
        const name = /var\(\s*(--[\w-]+)/.exec(match[0])?.[1] ?? match[0]
        report(decl, "read", [name], { word: name })
      }
    })
  },
)
