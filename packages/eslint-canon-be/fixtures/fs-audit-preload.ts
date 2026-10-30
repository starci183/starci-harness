/** Preloaded into every spec process of this canon (see `npm test`): runs each rule of the canon under the file-system recorder of ./fs-audit.ts. */
import { RuleTester } from "eslint"
import ts from "typescript"
import { crossFileInputs } from "../src/cross-file-inputs.ts"
import { rules } from "../src/index.ts"
import { rules as projectGraphRules } from "../src/project-graph.ts"
import { installFsAudit, packageRootOf } from "./fs-audit.ts"

installFsAudit({ name: "@starci/eslint-canon-be", rules, inputs: crossFileInputs, exempt: Object.keys(projectGraphRules), packageRoot: packageRootOf(import.meta.url), RuleTester, ts })
