import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { mascotAssetSlotRequired } from "./mascot.ts"

const BLOCK = at("apps/web/src/components/blocks/Onboarding/component.tsx")
const ROUTE = at("apps/web/src/app/[locale]/(auth)/sign-in/page.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Image, Mascot, MediaFrame } from \"@starci/grammar/core\"\n"

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
