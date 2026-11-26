/** Edition proofs for the R62 native-element boundary. */
// proves: FE_NATIVE_FORM_CONTROL
// proves: FE_NATIVE_IMAGE
import assert from "node:assert/strict"
import { join } from "node:path"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { RuleTester } from "eslint"
import { appDeclaration } from "../../eslint-canon-be/fixtures/app.ts"
import { hfsFromDeclaration } from "./lib/hfs.ts"
import { PACKAGE_ROOT } from "./lib/package-root.ts"
import { why } from "./lib/why.ts"
import { imageHasSize, noNativeFormControl } from "./native-controls.ts"
import { canonTester } from "../fixtures/typed/tester.ts"

const ROOT = join(PACKAGE_ROOT, "fixtures", "typed")
const BLOCK = join(ROOT, "apps", "web", "src", "components", "blocks", "Feed", "component.tsx")

for (const edition of ['lite'] as const) {
  test(`R62 valid and invalid native elements in ${edition}`, () => {
    const declaration = appDeclaration("fe", { apps: [{ name: "web", kind: "next" }] })
    const hfs = hfsFromDeclaration({ ...declaration, edition }, ROOT)
    const tester = canonTester(new RuleTester({
      languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      settings: { starci: { hfs } },
    }))
    tester.run("no-native-form-control", noNativeFormControl, {
      valid: [{ filename: BLOCK, code: "export const Feed = () => <Button onPress={save} />" }],
      invalid: [
        { filename: BLOCK, code: "export const Feed = () => <button onClick={save} />", errors: [{ messageId: "native" }] },
        { filename: BLOCK, code: "export const Feed = () => <input />", errors: [{ messageId: "native" }] },
        { filename: BLOCK, code: "export const Feed = () => <select />", errors: [{ messageId: "native" }] },
        { filename: BLOCK, code: "export const Feed = () => <textarea />", errors: [{ messageId: "native" }] },
      ],
    })
    tester.run("image-has-size", imageHasSize, {
      valid: [
        { filename: BLOCK, code: "import Image from 'next/image'; export const Feed = () => <Image src={photo} width={80} height={80} alt={label} />" },
        { filename: BLOCK, code: "import Image from 'next/image'; export const Feed = () => <Image src={photo} fill sizes='100vw' alt={label} />" },
      ],
      invalid: [
        { filename: BLOCK, code: "import Image from 'next/image'; export const Feed = () => <Image src={photo} alt={label} />", errors: [{ messageId: "size" }] },
        { filename: BLOCK, code: "import Image from 'next/image'; export const Feed = () => <Image src={photo} fill alt={label} />", errors: [{ messageId: "sizes" }] },
      ],
    })
    assert.equal(why["no-native-form-control"].code, "FE_NATIVE_FORM_CONTROL")
    assert.equal(why["image-has-size"].code, "FE_NATIVE_IMAGE")
  })
}
