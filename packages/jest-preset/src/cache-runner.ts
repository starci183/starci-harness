/**
 * The runner of the integration and e2e projects of an app that has no test-world globalSetup, so no data slots (a lite app): the same runner as
 * `world-runner.js` (a process per file, in sequence, with the result cache of world-cache.ts) without the slot each file is bound to.
 */

import WorldRunner from "./world-runner"

class CacheRunner extends WorldRunner {
  protected override get slotted(): boolean {
    return false
  }
}

export = CacheRunner
