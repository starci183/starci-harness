/**
 * Twin tests for the hooks-folder rule (HFS R56, lint half).
 *
 *   node --test src/hooks-folder.spec.ts
 */
// proves: FE_HOOKS_ARE_HOOKS@lite FE_HOOKS_ARE_HOOKS@full
import assert from "node:assert/strict"
import test from "node:test"
import { at, fixtureHfs, slotTester } from "../fixtures/typed/tester.ts"
import { hooksFolderHoldsHooksOnly, rules } from "./hooks-folder.ts"

const tester = slotTester()

const HOOK = at("apps/web/src/hooks/project/useProject.ts")
const SHARED = at("apps/web/src/hooks/project/project.shared.ts")
const react = (code: string): string => `import { useState } from "react"\n${code}`

for (const edition of ["lite", "full"] as const) {
  test(`R56: canonical theme hooks preserve import identity (${edition})`, () => {
  assert.doesNotThrow(() => {
    const filename = at("apps/web/src/hooks/theme/useGrammarTheme.ts")
    const settings = { starci: { hfs: fixtureHfs(undefined, { lite: edition === "lite" }) } }
    const entry = (code: string) => ({ filename, code, settings })
    const refused = (code: string) => ({ ...entry(code), errors: [{ messageId: "fake" }] })
    tester.run("hooks-folder-holds-hooks-only", hooksFolderHoldsHooksOnly, {
      valid: [
        entry('import { useTheme } from "next-themes"; export const useGrammarTheme = () => useTheme()'),
        entry('import { useTheme as theme } from "next-themes"; export const useGrammarTheme = () => theme()'),
        entry('import * as Themes from "next-themes"; export const useGrammarTheme = () => Themes.useTheme()'),
        entry('import * as Themes from "next-themes"; const { useTheme: theme } = Themes; export const useGrammarTheme = () => theme()'),
        entry('import { useTheme } from "next-themes"; const theme = useTheme; export const useGrammarTheme = () => theme()'),
        entry('import * as Themes from "next-themes"; export const useGrammarTheme = () => Themes["useTheme"]()'),
      ],
      invalid: [
        refused('const useTheme = () => "dark"; export const useGrammarTheme = () => useTheme()'),
        refused('import { useTheme } from "another-theme"; export const useGrammarTheme = () => useTheme()'),
        refused('import { useTheme } from "next-themes/private"; export const useGrammarTheme = () => useTheme()'),
        refused('import { useFake } from "next-themes"; export const useGrammarTheme = () => useFake()'),
        refused('import type { useTheme } from "next-themes"; export const useGrammarTheme = () => useTheme()'),
        refused('import { useTheme } from "next-themes"; export const useGrammarTheme = (useTheme) => useTheme()'),
        refused('import * as Themes from "next-themes"; export const useGrammarTheme = (Themes) => Themes.useTheme()'),
        refused('import { useTheme } from "next-themes"; let theme = useTheme; theme = () => "dark"; export const useGrammarTheme = () => theme()'),
        refused('import Themes from "next-themes"; export const useGrammarTheme = () => Themes.useTheme()'),
        refused('const Themes = { useTheme: () => "dark" }; export const useGrammarTheme = () => Themes.useTheme()'),
        refused('import { useTheme } from "next-themes"; export const useGrammarTheme = () => { const unused = () => useTheme(); return "dark" }'),
      ],
    })
  
  })
})
}

test("every rule this law declares is a rule", () => {
  for (const [name, rule] of Object.entries(rules)) assert.ok(rule?.meta && rule.create, `${name} is not a rule`)
})

test("FE-HOOKS-1: hooks/ holds hooks, one shared helper file per domain, and nothing else", () => {
  assert.doesNotThrow(() => {
  tester.run("hooks-folder-holds-hooks-only", hooksFolderHoldsHooksOnly, {
    valid: [
      { filename: HOOK, code: react("export const useProject = () => useState(1)") },
      { filename: HOOK, code: react("export function useProject() { return useState(1) }") },
      { filename: HOOK, code: react("export type ProjectState = { id: string }\nexport const useProject = () => useState(1)") },
      // a private helper is an implementation detail of the hook
      { filename: HOOK, code: react("const key = (id) => id\nexport const useProject = () => useState(key(1))") },
      { filename: SHARED, code: "export const projectKey = (id) => [\"project\", id]" },
      // the domain's entry is a file the slot names: it is not a stray helper
      { filename: at("apps/web/src/hooks/project/index.ts"), code: "export { useProject } from \"./useProject\"" },
      // the second app has its own hooks folder
      { filename: at("apps/admin/src/hooks/project/useProject.ts"), code: react("export const useProject = () => useState(1)") },
      // a folder named hooks that no slot owns is not judged by this rule
      { filename: at("apps/web/src/modules/hooks/x.ts"), code: "export const x = 1" },
      { filename: at("apps/web/src/components/blocks/Feed/hooks/helpers.ts"), code: "export const x = 1" },
      // outside hooks/, nothing is governed here
      { filename: at("apps/web/src/modules/api/graphql/queries/query-project.ts"), code: "export const queryProject = () => 1" },
      { filename: at("apps/web/src/modules/i18n/request.ts"), code: "import \"server-only\"\nexport const request = () => 1" },
      { filename: at("apps/web/src/components/blocks/Feed/index.tsx"), code: "export const Feed = () => null" },
    ],
    invalid: [
      { filename: at("apps/web/src/hooks/useProject.ts"), code: react("export const useProject = () => useState(1)"), errors: [{ messageId: "domain" }] },
      { filename: at("apps/web/src/hooks/project/readProject.ts"), code: "export const readProject = () => 1", errors: [{ messageId: "notHook" }] },
      { filename: at("apps/web/src/hooks/project/useProject.tsx"), code: react("export const useProject = () => useState(1)"), errors: [{ messageId: "notHook" }] },
      { filename: at("apps/web/src/hooks/project/helpers.ts"), code: "export const h = 1", errors: [{ messageId: "notHook" }] },
      // a shared file named for another domain is not this domain's
      { filename: at("apps/web/src/hooks/project/item.shared.ts"), code: "export const h = 1", errors: [{ messageId: "notHook" }] },
      { filename: HOOK, code: react("export const useProject = () => useState(1)\nexport const projectKey = () => useState(2)"), errors: [{ messageId: "export" }] },
      { filename: HOOK, code: react("export const useProject = () => useState(1)\nexport const useItem = () => useState(2)"), errors: [{ messageId: "many" }] },
      { filename: SHARED, code: react("export const useProjectKey = () => useState(1)"), errors: [{ messageId: "sharedHook" }] },
      { filename: HOOK, code: react("import \"server-only\"\nexport const useProject = () => useState(1)"), errors: [{ messageId: "server" }] },
      { filename: HOOK, code: react("import { headers } from \"next/headers\"\nexport const useProject = () => { useState(1); return headers() }"), errors: [{ messageId: "server" }] },
    ],
  })

  })
})

test("FE-HOOKS-2: each hooks family holds the files its slot names, one hook per hook file", () => {
  assert.doesNotThrow(() => {
  const SWR = "apps/web/src/hooks/swr"
  tester.run("hooks-folder-holds-hooks-only", hooksFolderHoldsHooksOnly, {
    valid: [
      // one SWR hook per modules/api operation, under the name its protocol and kind give it
      { filename: at(`${SWR}/api/graphql/queries/useQueryProjectSwr.ts`), code: react("export const useQueryProjectSwr = () => useState(1)") },
      { filename: at(`${SWR}/api/graphql/mutations/useMutateEnrollSwr.ts`), code: react("export const useMutateEnrollSwr = () => useState(1)") },
      // a hook file exports its SWR key beside the hook, so a mutation or a socket message revalidates that entry
      { filename: at(`${SWR}/api/graphql/queries/useQueryProjectSwr.ts`), code: react("export const QUERY_PROJECT_SWR_KEY = \"QUERY_PROJECT_SWR\"\nexport const useQueryProjectSwr = () => useState(1)") },
      { filename: at("apps/web/src/hooks/auth/useAuthUser.ts"), code: react("export const AUTH_USER_SWR_KEY = \"AUTH_USER_SWR\"\nexport const useAuthUser = () => useState(1)") },
      { filename: at(`${SWR}/api/rest/queries/useGetUploadSwr.ts`), code: react("export const useGetUploadSwr = () => useState(1)") },
      { filename: at(`${SWR}/api/rest/mutations/usePostUploadSwr.ts`), code: react("export const usePostUploadSwr = () => useState(1)") },
      { filename: at(`${SWR}/api/sse/subscriptions/useSubscribeOrderStatusSwr.ts`), code: "import useSWRSubscription from 'swr/subscription'; export const SUBSCRIBE_ORDER_STATUS_SWR_KEY = 'order'; export const useSubscribeOrderStatusSwr = () => useSWRSubscription(SUBSCRIBE_ORDER_STATUS_SWR_KEY, () => () => 1)" },
      { filename: at(`${SWR}/api/sse/subscriptions/index.ts`), code: "export { useSubscribeOrderStatusSwr } from './useSubscribeOrderStatusSwr'" },
      // the family's barrels and its side-effect component (the one .tsx a family names) are not hook files
      { filename: at(`${SWR}/index.ts`), code: "export * from \"./api\"\nexport { SwrSideEffects } from \"./SwrSideEffects\"" },
      { filename: at(`${SWR}/api/graphql/queries/index.ts`), code: "export * from \"./useQueryProjectSwr\"" },
      { filename: at(`${SWR}/SwrSideEffects.tsx`), code: "export const SwrSideEffects = () => null" },
      { filename: at("apps/web/src/hooks/socketio/SocketIoSideEffects.tsx"), code: "export const SocketIoSideEffects = () => null" },
      // a form, a local store and its selector, the sockets and their enums and types, an effect, a reusable hook
      { filename: at("apps/web/src/hooks/rhf/useContactForm.ts"), code: react("export const useContactForm = () => useState(1)") },
      { filename: at("apps/web/src/hooks/zustand/cart/store.ts"), code: "export const useCartStore = create(() => ({}))\nexport type CartState = { n: number }" },
      { filename: at("apps/web/src/hooks/zustand/cart/useCartCount.ts"), code: react("export const useCartCount = () => useState(1)") },
      { filename: at("apps/web/src/hooks/socketio/sockets.ts"), code: "export const chatSocket = io(\"/chat\")\nexport const jobSocket = io(\"/jobs\")" },
      { filename: at("apps/web/src/hooks/socketio/enums/subscription-event.ts"), code: "export enum SubscriptionEvent { Message = \"message\" }" },
      { filename: at("apps/web/src/hooks/socketio/types/chat.ts"), code: "export type ChatMessage = { id: string }" },
      { filename: at("apps/web/src/hooks/socketio/useChatSocketIo.ts"), code: react("export const useChatSocketIo = () => useState(1)") },
      { filename: at("apps/web/src/hooks/effects/useSyncReduxProjectId.ts"), code: react("export const useSyncReduxProjectId = () => useState(1)") },
      { filename: at("apps/web/src/hooks/reuseables/useSmViewport.ts"), code: react("export const useSmViewport = () => useState(1)") },
    ],
    invalid: [
      // a name the family does not give: the wrong prefix for the folder, a hook outside api/, a helper, a .tsx outside the named ones
      { filename: at(`${SWR}/api/graphql/queries/useGetProjectSwr.ts`), code: react("export const useGetProjectSwr = () => useState(1)"), errors: [{ messageId: "family" }] },
      { filename: at(`${SWR}/api/sse/subscriptions/useOrderStatusSwr.ts`), code: react("export const useOrderStatusSwr = () => useState(1)"), errors: [{ messageId: "subscription" }] },
      { filename: at(`${SWR}/api/sse/useSubscribeOrderStatusSwr.ts`), code: react("export const useSubscribeOrderStatusSwr = () => useState(1)"), errors: [{ messageId: "family" }] },
      { filename: at(`${SWR}/api/graphql/mutations/useQueryProjectSwr.ts`), code: react("export const useQueryProjectSwr = () => useState(1)"), errors: [{ messageId: "family" }] },
      { filename: at(`${SWR}/useProject.ts`), code: react("export const useProject = () => useState(1)"), errors: [{ messageId: "family" }] },
      { filename: at(`${SWR}/api/graphql/queries/keys.ts`), code: "export const QUERY_PROJECT_SWR_KEY = \"project\"", errors: [{ messageId: "family" }] },
      { filename: at("apps/web/src/hooks/rhf/useContact.ts"), code: react("export const useContact = () => useState(1)"), errors: [{ messageId: "family" }] },
      { filename: at("apps/web/src/hooks/rhf/contact-schema.ts"), code: "export const schema = 1", errors: [{ messageId: "family" }] },
      { filename: at("apps/web/src/hooks/effects/UseEffects.tsx"), code: "export const UseEffects = () => null", errors: [{ messageId: "family" }] },
      { filename: at("apps/web/src/hooks/socketio/SocketProvider.tsx"), code: "export const SocketProvider = () => null", errors: [{ messageId: "family" }] },
      { filename: at("apps/web/src/hooks/zustand/cart/helpers.ts"), code: "export const h = 1", errors: [{ messageId: "family" }] },
      // a hook file of a family exports one hook and nothing else
      { filename: at(`${SWR}/api/graphql/queries/useQueryProjectSwr.ts`), code: react("export const useQueryProjectSwr = () => useState(1)\nexport const useQueryItemSwr = () => useState(2)"), errors: [{ messageId: "many" }] },
      { filename: at("apps/web/src/hooks/rhf/useContactForm.ts"), code: react("export const useContactForm = () => useState(1)\nexport const contactSchema = 2"), errors: [{ messageId: "export" }] },
      // a constant that is not an SWR key is still a helper
      { filename: at(`${SWR}/api/graphql/queries/useQueryProjectSwr.ts`), code: react("export const PROJECT_PAGE_SIZE = 20\nexport const useQueryProjectSwr = () => useState(1)"), errors: [{ messageId: "export" }] },
      // server-only code is never a hook, in any family
      { filename: at(`${SWR}/api/graphql/queries/useQueryProjectSwr.ts`), code: react("import \"server-only\"\nexport const useQueryProjectSwr = () => useState(1)"), errors: [{ messageId: "server" }] },
      { filename: at("apps/web/src/hooks/effects/useLocale.ts"), code: react("import { headers } from \"next/headers\"\nexport const useLocale = () => { useState(1); return headers() }"), errors: [{ messageId: "server" }] },
    ],
  })

  })
})

for (const edition of ["lite", "full"] as const) {
  test(`R56: zero-hook, default-export and fake use* files are refused (${edition})`, () => {
  assert.doesNotThrow(() => {
    const settings = { starci: { hfs: fixtureHfs(undefined, { lite: edition === "lite" }) } }
    const entry = (code: string, filename = HOOK) => ({ filename, code, settings })
    const refused = (code: string, messageId: string, filename = HOOK) => ({ ...entry(code, filename), errors: [{ messageId }] })
    tester.run("hooks-folder-holds-hooks-only", hooksFolderHoldsHooksOnly, {
      valid: [
        entry(react("export const useProject = () => useState(1)")),
        entry(react("export function useProject() { return useState(1) }")),
        entry("import { useState as state } from 'react'; const project = () => state(1); export { project as useProject }"),
        entry("import { useState } from 'react'; const state = useState; export const useProject = () => state(1)"),
        entry("import React from 'react'; export const useProject = () => React.useState(1)"),
        entry("import * as React from 'react'; const hooks = React; export const useProject = () => hooks['useState'](1)"),
        entry("import * as React from 'react'; const { useState: state } = React; export const useProject = () => state(1)"),
        entry("import { use } from 'react'; export const useProject = () => use(Promise.resolve(1))"),
        entry(react("type useProjectType = number; export type { useProjectType }; export const useProject = () => useState(1)")),
        entry(react("type useProjectType = number; export { type useProjectType }; export const useProject = () => useState(1)")),
        entry("import request from 'swr'; export const QUERY_PROJECT_SWR_KEY = 'project'; export const useQueryProjectSwr = () => request(QUERY_PROJECT_SWR_KEY)", at("apps/web/src/hooks/swr/api/graphql/queries/useQueryProjectSwr.ts")),
        entry("import { default as request } from 'swr'; export const useProject = () => request('project')"),
        entry("import * as SWR from 'swr'; export const useProject = () => SWR.default('project')"),
        entry("import * as SWR from 'swr'; const { default: request } = SWR; export const useProject = () => request('project')"),
        entry("import { useSWRConfig as config } from 'swr'; export const useProject = () => config()"),
        entry("import request from 'swr/immutable'; export const useProject = () => request('project')"),
        entry("import request from 'swr/infinite'; export const useProject = () => request(() => 'project')"),
        entry("import request from 'swr/mutation'; export const useProject = () => request('project', () => 1)"),
      ],
      invalid: [
        refused("const privateHelper = () => 1", "missing"),
        refused("export const QUERY_PROJECT_SWR_KEY = 'project'", "missing"),
        refused("export type useProject = number", "missing"),
        refused("export default async function readProject() { return 1 }", "defaultExport"),
        refused(react("export default function useProject() { return useState(1) }"), "defaultExport"),
        refused(react("export const useProject = () => useState(1); export default useProject"), "defaultExport"),
        refused(react("const useProject = () => useState(1); export { useProject as default }"), "defaultExport"),
        refused("export const useProject = () => 1", "fake"),
        refused("export const useProject = 1", "fake"),
        refused("const useState = () => 1; export const useProject = () => useState()", "fake"),
        refused("import { useState } from './helpers'; export const useProject = () => useState(1)", "fake"),
        refused("import { useFake } from 'react'; export const useProject = () => useFake()", "fake"),
        refused("import useFake from 'swr/helpers'; export const useProject = () => useFake()", "fake"),
        refused("import { useSWR } from 'swr'; export const useProject = () => useSWR('project')", "fake"),
        refused("import * as SWR from 'swr'; export const useProject = () => SWR.useSWR('project')", "fake"),
        refused("import type { useState } from 'react'; export const useProject = () => useState(1)", "fake"),
        refused("import { type useState } from 'react'; export const useProject = () => useState(1)", "fake"),
        refused(react("export const useProject = (useState) => useState(1)"), "fake"),
        refused("import React from 'react'; export const useProject = (React) => React.useState(1)", "fake"),
        refused(react("const state = useState; export const useProject = (state) => state(1)"), "fake"),
        refused(react("let state = useState; state = () => 1; export const useProject = () => state(1)"), "fake"),
        refused(react("useState(1); export const useProject = () => 1"), "fake"),
        refused(react("export const useProject = () => { const unused = () => useState(1); return 1 }"), "fake"),
        refused(react("export const useProject = () => { function unused() { return useState(1) }; return 1 }"), "fake"),
        refused("import { useState as useProject } from 'react'; export { useProject }", "fake"),
        refused("export { useState as useProject } from 'react'", "fake"),
        refused("const React = { useState: () => 1 }; export const useProject = () => React.useState()", "fake"),
        refused("import React from 'react'; const method = 'useState'; export const useProject = () => React[method](1)", "fake"),
      ],
    })
  
  })
})
}
