/**
 * Twin tests for the mascot law (R338, R339): generated art under `/images/` renders only through Grammar's `Mascot` or
 * inside a `MediaFrame`, and every `Mascot` names its asset slot.
 *
 *   node --test src/mascot.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { generatedArtInMascotOrMediaFrame, mascotAssetSlotRequired, recommended, rules } from "./mascot.ts"

const BLOCK = at("apps/web/src/components/blocks/Onboarding/component.tsx")
const ROUTE = at("apps/web/src/app/[locale]/(auth)/sign-in/page.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Image, Mascot, MediaFrame } from \"@starci/grammar/core\"\n"

test("the law publishes two rules and both are errors", () => {
  assert.deepEqual(Object.keys(rules), ["generated-art-in-mascot-or-media-frame", "mascot-asset-slot-required"])
  assert.deepEqual(recommended, {
    "starci-grammar/generated-art-in-mascot-or-media-frame": "error",
    "starci-grammar/mascot-asset-slot-required": "error",
  })
})

test("R338: generated art under /images/ (webp or png) renders only through Mascot or inside MediaFrame", () => {
  slotTester().run("generated-art-in-mascot-or-media-frame", generatedArtInMascotOrMediaFrame, {
    valid: [
      // the Mascot renders generated art at its size scale
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Mascot src=\"/images/mascot/welcome.webp\" size=\"lg\" assetSlot=\"onboarding.welcome\" />" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <G.Mascot src={\"/images/mascot/welcome.png\"} assetSlot=\"onboarding.welcome\" />" },
      // an Image framed by a MediaFrame, directly or deeper
      { filename: BLOCK, code: IMPORTS + "export const A = () => <MediaFrame assetSlot=\"x\"><Image src=\"/images/scene/hero.webp\" alt=\"\" /></MediaFrame>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <MediaFrame caption=\"c\"><div><Image src={`/images/scene/hero.png`} alt=\"\" /></div></MediaFrame>" },
      // art that is not a generated raster under /images/
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Image src=\"/images/logo.svg\" alt=\"Logo\" />" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Image src=\"/photos/team.webp\" alt=\"Team\" />" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Image src=\"/images/photo.jpg\" alt=\"Photo\" />" },
      // a source the rule cannot read statically is not judged
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Image src={p.src} alt=\"\" />" },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Image src={`/images/${p.name}.webp`} alt=\"\" />" },
      // a script is not product source
      { filename: SCRIPT, code: "export const A = () => <img src=\"/images/mascot/welcome.webp\" alt=\"\" />" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Image src=\"/images/mascot/welcome.webp\" alt=\"\" />", errors: [{ messageId: "outside", data: { src: "/images/mascot/welcome.webp", element: "Image" } }] },
      { filename: ROUTE, code: "export default () => <img src=\"/images/mascot/sign-in.png\" alt=\"\" />", errors: [{ messageId: "outside", data: { src: "/images/mascot/sign-in.png", element: "img" } }] },
      // any case of the extension, a query string, an expression container and a template literal
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Image src={\"/images/a/B.PNG?v=2\"} alt=\"\" />", errors: [{ messageId: "outside" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Image src={`/images/a/b.webp`} alt=\"\" />", errors: [{ messageId: "outside" }] },
      // a module constant the attribute reads
      { filename: BLOCK, code: IMPORTS + "const ART = \"/images/mascot/welcome.webp\"\nexport const A = () => <Image src={ART} alt=\"\" />", errors: [{ messageId: "outside" }] },
      // another Grammar component that takes a src (Avatar) is not the mascot's renderer
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Avatar name=\"Turtle\" src=\"/images/mascot/face.webp\" />", errors: [{ messageId: "outside" }] },
      // a sibling of a MediaFrame is not inside it
      { filename: BLOCK, code: IMPORTS + "export const A = () => <div><MediaFrame><Image src=\"/images/a.webp\" alt=\"\" /></MediaFrame><Image src=\"/images/b.webp\" alt=\"\" /></div>", errors: [{ messageId: "outside", data: { src: "/images/b.webp", element: "Image" } }] },
    ],
  })
})

test("R339: every Mascot names its asset slot", () => {
  slotTester().run("mascot-asset-slot-required", mascotAssetSlotRequired, {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Mascot src=\"/images/mascot/welcome.webp\" assetSlot=\"onboarding.welcome\" />" },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Mascot src={p.src} assetSlot={p.slot} assetSha256={p.sha} />" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <G.Mascot src=\"/images/m.webp\" assetSlot=\"x\" />" },
      // a spread may carry the slot; the rule does not guess
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Mascot {...p} />" },
      // another component is not judged
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Image src=\"/x.webp\" alt=\"\" />" },
      { filename: SCRIPT, code: "export const A = () => <Mascot src=\"/images/m.webp\" />" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Mascot src=\"/images/mascot/welcome.webp\" />", errors: [{ messageId: "missing" }] },
      { filename: ROUTE, code: IMPORTS + "export default () => <G.Mascot src=\"/images/mascot/welcome.webp\" size=\"hero\" assetSha256=\"abc\" />", errors: [{ messageId: "missing" }] },
      // an empty or undefined slot names nothing
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Mascot src=\"/images/m.webp\" assetSlot=\"\" />", errors: [{ messageId: "missing" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Mascot src=\"/images/m.webp\" assetSlot={undefined} />", errors: [{ messageId: "missing" }] },
    ],
  })
})
