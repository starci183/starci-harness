import type { Rule } from "eslint"
import { defineFamilyRules, defineRule, exemptFreestyle } from "./lib/rule-contract.ts"
import { composesGrammar } from "./grammar-boundary.ts"
/**
 * The media law (HFS R436 `FE_RAW_MEDIA_ELEMENT`): pictures, video and decorative art are drawn by the Grammar's `Image`,
 * `Video` and `Illustration`, never by a raw `<img>`, `<video>` or `<picture>`.
 *
 * A raw element holds no ratio before its bytes arrive (the page jumps), loads at once whatever the viewport, draws no
 * loading or failure state, picks no rendition for the screen, carries no required `alt`, no WebVTT track contract and no
 * stream player, and wears no corner radius of the theme. The Grammar's three components own all of that, once.
 *
 * WHAT IT READS. The JSX elements `img`, `video` and `picture`. `audio`, `source` and `track` are not refused: the Grammar
 * has no component for them (`source` and `track` only ever live inside the refused elements).
 *
 * WHERE IT APPLIES. The files `no-raw-structural-element` judges (app source that composes the Grammar and any workspace
 * package but the `<family>-ui` package, whose components are the renderers: the Grammar's own implementation is the one
 * place a raw media element belongs). A Freestyle region's raw elements are exempt, and an element with a spread attribute is
 * judged like any other.
 */

/** The raw media elements and the Grammar component that draws what each one stands for. */
export const MEDIA_OWNERS: Readonly<Record<string, string>> = Object.freeze({
  img: "`Image` (a picture with content) or `Illustration` (decorative art, with `alt` left empty)",
  picture: "`Illustration` with `compact` for art direction, or `Image` with `renditions` and `sizes` for resolution switching",
  video: "`Video` with `sources`, `poster` and `tracks`",
})

/** No raw `<img>`, `<video>` or `<picture>` in app source: the Grammar's media components draw them. */
export const noRawMedia: Rule.RuleModule = exemptFreestyle(defineRule({
  meta: {
    type: "problem",
    docs: { description: "R436: a picture, a video or decorative art is a Grammar Image, Video or Illustration, never a raw <img>, <video> or <picture>." },
    schema: [],
    messages: {
      raw:
        "A raw `<{{tag}}>`. It reserves no ratio (the page jumps when it loads), loads at once, draws no loading or failure state and carries none of the Grammar's alt, rendition, caption, track or stream contract. Use {{owner}}. If the Grammar cannot express this media, add the component or prop to the Grammar rather than drawing it here.",
    },
  },
  create(context) {
    const file = context.filename || context.getFilename()
    if (!composesGrammar(context, file)) return {}
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return
        const owner = Object.hasOwn(MEDIA_OWNERS, node.name.name) ? MEDIA_OWNERS[node.name.name] ?? null : null
        if (owner !== null) context.report({ node, messageId: "raw", data: { tag: node.name.name, owner } })
      },
    }
  },
}))

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "no-raw-media": noRawMedia,
}

defineFamilyRules(rules, "knowledge/hfs/rules.yaml#R436")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
