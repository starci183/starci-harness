import test from "node:test"
import { projectFixture } from "../../eslint-canon-be/fixtures/project/tester.ts"
import { canonTester } from "../fixtures/typed/tester.ts"
import { hooksFolderHoldsHooksOnly } from "./hooks-folder.ts"

// proves: FE_HOOKS_ARE_HOOKS@lite FE_HOOKS_ARE_HOOKS@full
for (const edition of ["lite", "full"] as const) {
  test(`R56 ${edition} proves canonical module hooks by their real body and import provenance`, t => {
    const filename = "apps/web/src/hooks/chat/useCommands.ts"
    const files = {
      "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", module: "ESNext", baseUrl: ".", paths: { "@/*": ["apps/web/src/*"] } }, include: ["apps/**/*"] }),
      [filename]: "export const useCommands = () => 1",
      "apps/web/src/modules/toast/index.ts": `export { useReal as useToast, useReexported, usePure, useNested, useString, useImpostor, useCycleA, useAliasCycle } from "./hooks"
export type { useReal as useTyped } from "./hooks"
export { useWrong } from "../other/hooks"
`,
      "apps/web/src/modules/toast/hooks.ts": `import { useCallback as callback } from "react"
import { useState as impostor } from "fake-react"
import { callback as throughBarrel } from "./api"
const alias = callback
export const useReal = () => alias(() => 1, [])
export const useReexported = () => throughBarrel(() => 1, [])
export const usePure = () => 1
export const useNested = () => { const unused = () => callback(() => 1, []); return 1 }
export const useString = () => "callback()"
export const useImpostor = () => impostor()
export const useCycleA = () => useCycleB()
export const useCycleB = () => useCycleA()
const a = b
const b = a
export const useAliasCycle = () => a()
`,
      "apps/web/src/modules/toast/api.ts": 'export { useCallback as callback } from "react"',
      "apps/web/src/modules/other/hooks.ts": 'import { useCallback } from "react"; export const useWrong = () => useCallback(() => 1, [])',
    }
    const f = projectFixture({ profile: "fe", edition, files })
    t.after(f.cleanup)
    const use = (name: string, alias = name) => `import { ${name} as ${alias} } from "@/modules/toast"; export const useCommands = () => ${alias}()`
    const entry = (code: string) => ({ filename: f.at(filename), code })
    const bad = (code: string) => ({ ...entry(code), errors: [{ messageId: "fake" }] })
    canonTester(f.tester).run("hooks-folder-holds-hooks-only", hooksFolderHoldsHooksOnly, {
      valid: [entry(use("useToast")), entry(use("useToast", "toast")), entry(use("useReexported"))],
      invalid: [bad(use("usePure")), bad(use("useNested")), bad(use("useString")), bad(use("useImpostor")),
        bad(use("useCycleA")), bad(use("useAliasCycle")), bad(use("useTyped")), bad(use("useWrong")),
        bad('import type { useToast } from "@/modules/toast"; export const useCommands = () => useToast()')],
    })
  })
}
