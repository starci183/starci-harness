import { existsSync } from "node:fs"
import { join } from "node:path"

/** Whether the checkout is the harness repository itself: the CLI, the contexts it reads and the packages it publishes. */
export const isHarnessCheckout = (root: string): boolean => existsSync(join(root, "cli", "package.json")) && existsSync(join(root, "contexts", "README.md")) && existsSync(join(root, "packages"))
