/**
 * Preloaded into every spec process of this package (see `npm test`): runs each rule of the Grammar lint under the file-system recorder of the
 * shared back-end fixtures. The specs lint through the front-end canon's RuleTester, so both copies of ESLint (this package's and that canon's)
 * and both copies of TypeScript are patched.
 */
import { createRequire } from "node:module"
import { RuleTester } from "eslint"
import ts from "typescript"
import { installFsAudit, packageRootOf, type RuleTesterClass } from "../../eslint-canon-be/fixtures/fs-audit.ts"
import { crossFileInputs } from "../src/cross-file-inputs.ts"
import { rules } from "../src/index.ts"

const fe = createRequire(new URL("../../eslint-canon-fe/fixtures/typed/tester.ts", import.meta.url))
const feEslint: { RuleTester: RuleTesterClass } = fe("eslint")
const feTs: typeof ts = fe("typescript")

installFsAudit({ name: "@starci/eslint-grammar-core", rules, inputs: crossFileInputs, packageRoot: packageRootOf(import.meta.url), RuleTester: [RuleTester, feEslint.RuleTester], ts: [ts, feTs] })
