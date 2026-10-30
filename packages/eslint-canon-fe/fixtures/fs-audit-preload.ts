/** Preloaded into every spec process of this canon (see `npm test`): runs each rule of the canon under the file-system recorder of the shared back-end fixtures. */
import { RuleTester } from "eslint"
import ts from "typescript"
import { installFsAudit, packageRootOf } from "../../eslint-canon-be/fixtures/fs-audit.ts"
import { crossFileInputs } from "../src/cross-file-inputs.ts"
import { rules } from "../src/index.ts"
import { rules as projectGraphRules } from "../src/project-graph.ts"

installFsAudit({ name: "@starci/eslint-canon-fe", rules, inputs: crossFileInputs, exempt: Object.keys(projectGraphRules), packageRoot: packageRootOf(import.meta.url), RuleTester, ts })
