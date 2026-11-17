/**
 * Twin tests for the media law (R436): a picture, a video or decorative art is a Grammar `Image`, `Video` or `Illustration`,
 * never a raw `<img>`, `<video>` or `<picture>`.
 *
 *   node --test src/media.spec.ts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { MEDIA_OWNERS, noRawMedia, recommended, rules } from "./media.ts"
import { why } from "./lib/why.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const FEATURE = at("apps/web/src/features/pages/home/component.tsx")
const BLOCK = at("apps/web/src/components/blocks/Feed/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Image, Illustration, Video } from \"@starci/grammar/core\"\n"

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["no-raw-media"])
  assert.deepEqual(recommended, { "starci-grammar/no-raw-media": "error" })
})

test("every raw tag the rule refuses names a Grammar component that exists", () => {
  const grammar = join(HERE, "..", "..", "grammar", "src", "core", "leaf")
  for (const component of ["Image", "Illustration", "Video"]) assert.ok(readFileSync(join(grammar, component, "index.tsx"), "utf8").includes(`export const ${component}`), component)
  assert.deepEqual(Object.keys(MEDIA_OWNERS).sort(), ["img", "picture", "video"])
})

test("the finding carries its code and a fix hint", () => {
  assert.equal(why["no-raw-media"]?.code, "FE_RAW_MEDIA_ELEMENT")
  assert.match(why["no-raw-media"]?.fix ?? "", /Image/)
})

test("R436: media is drawn by Image, Video and Illustration, never a raw element", () => {
  slotTester().run("no-raw-media", noRawMedia, {
    valid: [
      { filename: FEATURE, code: IMPORTS + "export const A = () => <Image src=\"/a.webp\" alt=\"A cat\" ratio=\"4:3\" />" },
      { filename: FEATURE, code: IMPORTS + "export const A = () => <Illustration staticsKey=\"illustrations/empty/customers.png\" />" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Video title=\"Intro\" sources={[{ src: \"/a.webm\", type: \"video/webm\" }]} />" },
      // an element the Grammar has no component for stays available
      { filename: FEATURE, code: "export const A = () => <audio src=\"/a.mp3\" controls />" },
      // a Freestyle region's raw elements are exempt
      { filename: FEATURE, code: "import { Freestyle } from \"@starci/grammar/core\"\nexport const A = () => <Freestyle reason=\"third-party embed\"><video src=\"/a.mp4\" /></Freestyle>" },
      // a script is not app source
      { filename: SCRIPT, code: "export const A = () => <img src=\"/a.png\" alt=\"\" />" },
      // a member name is not the intrinsic element
      { filename: FEATURE, code: "export const A = () => <Media.img />" },
    ],
    invalid: [
      { filename: FEATURE, code: "export const A = () => <img src=\"/a.png\" alt=\"A cat\" />", errors: [{ messageId: "raw", data: { tag: "img", owner: MEDIA_OWNERS["img"] } }] },
      { filename: BLOCK, code: "export const A = () => <video src=\"/a.mp4\" controls />", errors: [{ messageId: "raw", data: { tag: "video", owner: MEDIA_OWNERS["video"] } }] },
      { filename: FEATURE, code: "export const A = () => <picture><source media=\"(max-width: 600px)\" srcSet=\"/s.png\" /><img src=\"/a.png\" alt=\"\" /></picture>", errors: [{ messageId: "raw", data: { tag: "picture", owner: MEDIA_OWNERS["picture"] } }, { messageId: "raw", data: { tag: "img", owner: MEDIA_OWNERS["img"] } }] },
      // a spread does not hide it
      { filename: BLOCK, code: "export const A = (p: P) => <img {...p} />", errors: [{ messageId: "raw", data: { tag: "img", owner: MEDIA_OWNERS["img"] } }] },
      // inside a Grammar component is still app source
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Image src=\"/a.png\" alt=\"\" caption=\"c\" />\nexport const B = () => <video />", errors: [{ messageId: "raw", data: { tag: "video", owner: MEDIA_OWNERS["video"] } }] },
    ],
  })
})
