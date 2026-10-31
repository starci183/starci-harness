/** Preloaded into every spec process of this canon (see `npm test`): runs each rule of the canon under the file-system recorder of the shared back-end fixtures. */
import { RuleTester } from "eslint"
import ts from "typescript"
import { installFsAudit, packageRootOf } from "../../eslint-canon-be/fixtures/fs-audit.ts"
import { crossFileInputs } from "../src/lib/cross-file-inputs.ts"
import { rules } from "../src/index.ts"
import { rules as projectGraphRules } from "../src/project-graph.ts"

/** `@/x` is `<app>/src/x` for the file that imports it: the alias every app's tsconfig declares and a fixture's does not. */
const alias = (specifier: string, file: string): string | null => {
  const at = file.replaceAll("\\", "/").lastIndexOf("/src/")
  return specifier.startsWith("@/") && at >= 0 ? `${file.replaceAll("\\", "/").slice(0, at)}/src/${specifier.slice(2)}` : null
}

installFsAudit({ name: "@starci/eslint-canon-fe", rules, inputs: crossFileInputs, exempt: Object.keys(projectGraphRules), packageRoot: packageRootOf(import.meta.url), RuleTester, ts, alias })
