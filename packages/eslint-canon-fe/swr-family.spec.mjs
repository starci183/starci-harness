// proves: FE_SWR_OUTSIDE_FAMILY@lite FE_SWR_OUTSIDE_FAMILY@full
// proves: FE_OP_OUTSIDE_SWR_HOOK@lite FE_OP_OUTSIDE_SWR_HOOK@full
// proves: FE_SUBSCRIPTION_NO_SNAPSHOT@lite FE_SUBSCRIPTION_NO_SNAPSHOT@full
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"
import test from "node:test"
import { RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { at, fixtureHfs, LITE_FE_DECLARATION } from "./fixtures/typed/tester.mjs"
import { hfsFromDeclaration } from "./lib/hfs.mjs"
import { appDeclaration } from "../eslint-canon-be/fixtures/app.mjs"
import { operationsOnlyInSwrHooks, rules, subscriptionRefetchesSnapshot, swrOnlyInFamily } from "./swr-family.mjs"

const COMPONENT = at("apps/web/src/components/blocks/Orders/index.tsx")
const HOOK = at("apps/web/src/hooks/orders/useOrders.ts")
const WRAPPER = at("apps/web/src/hooks/swr/api/graphql/queries/useQueryOrdersSwr.ts")
const SUBSCRIPTION = at("apps/web/src/hooks/swr/api/sse/subscriptions/useSubscribeOrderStatusSwr.ts")
const OP = "@/modules/api/graphql/queries/query-orders"
const STREAM_OP = "@/modules/api/sse/order-status/stream-order-status"
const testerFor = (lite) => new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
  settings: { starci: { hfs: fixtureHfs(lite ? LITE_FE_DECLARATION : undefined, { lite }) } },
})

for (const lite of [false, true]) {
  const edition = lite ? "lite" : "full"
  test(`R285 FE_SWR_OUTSIDE_FAMILY: consumers call wrappers (${edition})`, () => {
    assert.doesNotThrow(() => testerFor(lite).run("swr-only-in-family", swrOnlyInFamily, {
      valid: [
        { filename: WRAPPER, code: 'import useSWR from "swr"; export const useQueryOrdersSwr = () => useSWR("orders", queryOrders)' },
        { filename: COMPONENT, code: 'import { SWRConfig, useSWRConfig, mutate } from "swr"; export const Orders = () => null' },
        { filename: SUBSCRIPTION, code: 'import useSWRSubscription from "swr/subscription"; export const useSubscribeOrderStatusSwr = () => useSWRSubscription("order", () => () => 1)' },
        { filename: COMPONENT, code: 'import * as cache from "swr"; const Config = cache.SWRConfig' },
        { filename: HOOK, code: 'import { useQueryOrdersSwr } from "@/hooks/swr"; export const useOrders = () => useQueryOrdersSwr()' },
        { filename: HOOK, code: 'import type { SWRResponse } from "swr"; export const useOrders = () => 1' },
        { filename: HOOK, code: 'const useSWR = () => 1; export const useOrders = () => useSWR()' },
        { filename: HOOK, code: 'export { SWRConfig } from "swr"' },
      ],
      invalid: [
        { filename: COMPONENT, code: 'import useSWR from "swr"; export const Orders = () => useSWR("orders", load)', errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: 'import { default as query } from "swr"; export const useOrders = () => query("orders", load)', errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: 'import useMutation from "swr/mutation"; export const useOrders = () => useMutation("orders", save)', errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: 'import useSWRSubscription from "swr/subscription"; export const useOrders = () => useSWRSubscription("orders", () => () => 1)', errors: [{ messageId: "outside" }] },
        { filename: COMPONENT, code: 'import { default as listen } from "swr/subscription"; export const Orders = () => listen("orders", () => () => 1)', errors: [{ messageId: "outside" }] },
        { filename: COMPONENT, code: 'import * as swr from "swr"; export const Orders = () => swr.default("orders", load)', errors: [{ messageId: "outside" }] },
        { filename: COMPONENT, code: 'import * as swr from "swr"; const { default: useRequest } = swr', errors: [{ messageId: "outside" }] },
        { filename: at("apps/web/src/hooks/swr/SwrSideEffects.tsx"), code: 'import useSWR from "swr"', errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: 'export { default as useRequest } from "swr"', errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: 'export * from "swr"', errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: 'const request = import("swr/mutation")', errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: 'const request = require("swr/infinite")', errors: [{ messageId: "outside" }] },
      ],
    }))
  })

  test(`R285 FE_OP_OUTSIDE_SWR_HOOK: only wrappers consume operations (${edition})`, () => {
    assert.doesNotThrow(() => testerFor(lite).run("operations-only-in-swr-hooks", operationsOnlyInSwrHooks, {
      valid: [
        { filename: WRAPPER, code: `import useSWR from "swr"; import { queryOrders } from "${OP}"; export const useQueryOrdersSwr = () => useSWR("orders", queryOrders)` },
        { filename: WRAPPER, code: `import * as requests from "swr"; import { queryOrders } from "${OP}"; export const useQueryOrdersSwr = () => requests.default("orders", queryOrders)` },
        { filename: WRAPPER, code: `import useSWR from "swr"; import { queryOrders } from "${OP}"; const request = useSWR; export const useQueryOrdersSwr = () => request("orders", queryOrders)` },
        { filename: WRAPPER, code: `import useSWR from "swr"; import { queryOrders } from "${OP}"; const fetcher = () => queryOrders(); export const useQueryOrdersSwr = () => useSWR("orders", fetcher)` },
        { filename: at("apps/web/src/hooks/swr/api/graphql/mutations/useMutateOrderSwr.ts"), code: 'import useSWRMutation from "swr/mutation"; import { mutateOrder } from "@/modules/api/graphql/mutations/mutation-order"; export const useMutateOrderSwr = () => useSWRMutation("order", mutateOrder)' },
        { filename: SUBSCRIPTION, code: `import useSWRSubscription from "swr/subscription"; import { streamOrderStatus } from "${STREAM_OP}"; export const useSubscribeOrderStatusSwr = () => useSWRSubscription("order", (key, { next }) => { const controller = new AbortController(); void streamOrderStatus({ signal: controller.signal, onPush: (push) => next(null, push) }); return () => controller.abort() })` },
        { filename: HOOK, code: `import type { QueryOrdersData } from "${OP}"; export const useOrders = () => 1` },
        { filename: HOOK, code: `import { type QueryOrdersData } from "${OP}"; export const useOrders = () => 1` },
        { filename: COMPONENT, code: 'import { useQueryOrdersSwr } from "@/hooks/swr"; export const Orders = () => useQueryOrdersSwr()' },
        { filename: at("apps/web/src/modules/api/graphql/queries/query-orders.ts"), code: 'import { client } from "@/modules/api/graphql/clients"; export const queryOrders = () => client.query({})' },
        { filename: HOOK, code: 'import { GraphQLResponse } from "@/modules/api/graphql/types"; export const useOrders = () => 1' },
        { filename: HOOK, code: 'require(123); import(123)' },
      ],
      invalid: [
        { filename: HOOK, code: `import { queryOrders } from "${OP}"; export const useOrders = () => queryOrders()`, errors: [{ messageId: "outside" }] },
        { filename: COMPONENT, code: `import { queryOrders as load } from "${OP}"; export const Orders = () => load()`, errors: [{ messageId: "outside" }] },
        { filename: at("apps/web/src/features/pages/OrdersPage/index.tsx"), code: `import { queryOrders } from "${OP}"; export const OrdersPage = async () => await queryOrders()`, errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: 'import { queryOrders } from "../../modules/api/graphql/queries/query-orders"', errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: 'import { getUpload } from "@/modules/api/rest/uploads/get-upload"', errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: `import { streamOrderStatus } from "${STREAM_OP}"; export const useOrders = () => streamOrderStatus()`, errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: 'import { followEventStream } from "@/modules/api/sse/clients/read-event-stream"; export const useOrders = () => followEventStream()', errors: [{ messageId: "outside" }] },
        { filename: SUBSCRIPTION, code: `import { streamOrderStatus } from "${STREAM_OP}"; export const useSubscribeOrderStatusSwr = () => streamOrderStatus()`, errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: 'import { queryOrders } from "@/modules/api"', errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: 'import { client } from "@/modules/api/graphql/clients/client"; export const useOrders = () => client.query({})', errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: `export { queryOrders } from "${OP}"`, errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: `export * from "${OP}"`, errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: `const operations = import("${OP}")`, errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: "const operations = import(`@/modules/api/graphql/queries/query-orders`)", errors: [{ messageId: "outside" }] },
        { filename: HOOK, code: `const operations = require("${OP}")`, errors: [{ messageId: "outside" }] },
        { filename: WRAPPER, code: `import { queryOrders } from "${OP}"; export const useQueryOrdersSwr = () => queryOrders()`, errors: [{ messageId: "outside" }] },
        { filename: WRAPPER, code: `import useSWR from "swr"; import { queryOrders } from "${OP}"; export const useQueryOrdersSwr = () => { const useSWR = () => queryOrders(); return useSWR() }`, errors: [{ messageId: "outside" }] },
        { filename: WRAPPER, code: `import useSWR from "swr"; import { queryOrders } from "${OP}"; useSWR("dummy", () => 1); export const useQueryOrdersSwr = () => queryOrders()`, errors: [{ messageId: "outside" }] },
        { filename: WRAPPER, code: `import useSWR from "swr"; import { queryOrders } from "${OP}"; queryOrders(); export const useQueryOrdersSwr = () => useSWR("orders", queryOrders)`, errors: [{ messageId: "outside" }] },
        { filename: at("apps/web/src/hooks/swr/SwrSideEffects.tsx"), code: `import { queryOrders } from "${OP}"`, errors: [{ messageId: "outside" }] },
      ],
    }))
  })
}

test("R285: bare workspace API imports use declared package identity", (t) => {
  const temporaryRoot = resolve(tmpdir())
  const root = mkdtempSync(join(temporaryRoot, "starci-a14-api-"))
  const withinTemporaryRoot = relative(temporaryRoot, resolve(root))
  assert.ok(withinTemporaryRoot && !withinTemporaryRoot.startsWith("..") && !isAbsolute(withinTemporaryRoot))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const api = join(root, "packages", "commerce-api")
  mkdirSync(api, { recursive: true })
  writeFileSync(join(api, "package.json"), JSON.stringify({ name: "@shop/data-door" }))
  const hfs = hfsFromDeclaration(appDeclaration("fe", {
    apps: [{ name: "web", kind: "next" }], optionalSlots: ["repo.packages", "fe.package.api"],
  }), root)
  const tester = new RuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs } },
  })
  tester.run("operations-only-in-swr-hooks", operationsOnlyInSwrHooks, {
    valid: [{
      filename: join(root, "apps/web/src/hooks/swr/api/graphql/queries/useQueryOrdersSwr.ts"),
      code: 'import useSWR from "swr"; import { queryOrders } from "@shop/data-door"; export const useQueryOrdersSwr = () => useSWR("orders", queryOrders)',
    }],
    invalid: [
      { filename: join(root, "apps/web/src/hooks/orders/useOrders.ts"), code: 'import { queryOrders } from "@shop/data-door"', errors: [{ messageId: "outside" }] },
      { filename: join(root, "apps/web/src/hooks/orders/useOrders.ts"), code: 'import { queryOrders } from "@shop/data-door/graphql/queries/query-orders"', errors: [{ messageId: "outside" }] },
    ],
  })
})

const GRAPHQL_STREAM_OP = "@/modules/api/graphql/subscriptions/subscription-order-status"
const subscribeHook = (operation, name, call) =>
  `import useSWRSubscription from "swr/subscription"; import { ${name} } from "${operation}"; export const useSubscribeOrderStatusSwr = () => useSWRSubscription("order", (key, { next }) => { ${call}; return () => undefined })`

for (const lite of [false, true]) {
  test(`R285 FE_SUBSCRIPTION_NO_SNAPSHOT: a subscription hook revalidates its snapshot when the stream opens (${lite ? "lite" : "full"})`, () => {
    assert.doesNotThrow(() => testerFor(lite).run("subscription-refetches-snapshot", subscriptionRefetchesSnapshot, {
      valid: [
        { filename: SUBSCRIPTION, code: subscribeHook(STREAM_OP, "streamOrderStatus", "void streamOrderStatus({ onOpen: () => void mutate(\"order\"), onPush: (push) => next(null, push) })") },
        { filename: SUBSCRIPTION, code: subscribeHook(GRAPHQL_STREAM_OP, "subscribeOrderStatus", "void subscribeOrderStatus({ onOpen() { void mutate(\"order\") } })") },
        // only the subscription hooks of the SWR family are judged
        { filename: WRAPPER, code: `import { streamOrderStatus } from "${STREAM_OP}"; export const useQueryOrdersSwr = () => streamOrderStatus({})` },
      ],
      invalid: [
        { filename: SUBSCRIPTION, code: subscribeHook(STREAM_OP, "streamOrderStatus", "void streamOrderStatus({ onPush: (push) => next(null, push) })"), errors: [{ messageId: "missing" }] },
        { filename: SUBSCRIPTION, code: subscribeHook(GRAPHQL_STREAM_OP, "subscribeOrderStatus", "void subscribeOrderStatus({ onOpen: () => {} })"), errors: [{ messageId: "missing" }] },
        { filename: SUBSCRIPTION, code: subscribeHook(STREAM_OP, "streamOrderStatus", "void streamOrderStatus(options)"), errors: [{ messageId: "missing" }] },
        { filename: SUBSCRIPTION, code: subscribeHook(STREAM_OP, "streamOrderStatus", "void streamOrderStatus({ onOpen: undefined })"), errors: [{ messageId: "missing" }] },
      ],
    }))
  })
}

const ns = (call) =>
  `import useSWRSubscription from "swr/subscription"; import * as ops from "${STREAM_OP}"; export const useSubscribeOrderStatusSwr = () => useSWRSubscription("order", (key, { next }) => { ${call}; return () => undefined })`
const READER = "@/modules/api/sse/clients/read-event-stream"

for (const lite of [false, true]) {
  test(`R285 FE_SUBSCRIPTION_NO_SNAPSHOT: namespaces, aliases, a mutate in onOpen and the stream reader (${lite ? "lite" : "full"})`, () => {
    assert.doesNotThrow(() => testerFor(lite).run("subscription-refetches-snapshot", subscriptionRefetchesSnapshot, {
      valid: [
        { filename: SUBSCRIPTION, code: ns('void ops.streamOrderStatus({ onOpen: () => void mutate("order") })') },
        { filename: SUBSCRIPTION, code: subscribeHook(STREAM_OP, "streamOrderStatus", 'const open = streamOrderStatus; void open({ onOpen: () => void mutate("order") })') },
        { filename: SUBSCRIPTION, code: subscribeHook(STREAM_OP, "streamOrderStatus", 'const refresh = () => void mutate("order"); void streamOrderStatus({ onOpen: refresh })') },
      ],
      invalid: [
        { filename: SUBSCRIPTION, code: subscribeHook(STREAM_OP, "streamOrderStatus", "void streamOrderStatus({ onOpen: () => undefined })"), errors: [{ messageId: "missing" }] },
        { filename: SUBSCRIPTION, code: subscribeHook(STREAM_OP, "streamOrderStatus", "void streamOrderStatus({ onOpen: () => console.info(1) })"), errors: [{ messageId: "missing" }] },
        { filename: SUBSCRIPTION, code: ns("void ops.streamOrderStatus({})"), errors: [{ messageId: "missing" }] },
        { filename: SUBSCRIPTION, code: subscribeHook(STREAM_OP, "streamOrderStatus", "const open = streamOrderStatus; void open({})"), errors: [{ messageId: "missing" }] },
        // a subscription hook that follows no stream operation is not one
        { filename: SUBSCRIPTION, code: subscribeHook(OP, "queryOrders", "void queryOrders({ request: {} })"), errors: [{ messageId: "noStream" }] },
        // the reader is not a stream operation: a hook that calls it directly has no operation to judge
        { filename: SUBSCRIPTION, code: `import useSWRSubscription from "swr/subscription"; import { followEventStream } from "${READER}"; export const useSubscribeOrderStatusSwr = () => useSWRSubscription("order", () => { void followEventStream({ onOpen: () => {} }); return () => undefined })`, errors: [{ messageId: "noStream" }] },
      ],
    }))
  })

  test(`R285 FE_OP_OUTSIDE_SWR_HOOK: only a stream operation imports the stream reader, even inside a fetcher (${lite ? "lite" : "full"})`, () => {
    assert.doesNotThrow(() => testerFor(lite).run("operations-only-in-swr-hooks", operationsOnlyInSwrHooks, {
      valid: [],
      invalid: [
        { filename: SUBSCRIPTION, code: `import useSWRSubscription from "swr/subscription"; import { followEventStream } from "${READER}"; export const useSubscribeOrderStatusSwr = () => useSWRSubscription("order", () => { void followEventStream({}); return () => undefined })`, errors: [{ messageId: "outside" }] },
        { filename: at("apps/web/src/hooks/swr/api/rest/queries/useGetOrdersSwr.ts"), code: `import useSWR from "swr"; import { followEventStream } from "${READER}"; export const useGetOrdersSwr = () => useSWR("orders", () => followEventStream({}))`, errors: [{ messageId: "outside" }] },
      ],
    }))
  })
}

test("R285: append-only plugin registration preserves every new enforcer and owner", async () => {
  const plugin = await import("./index.mjs")
  for (const [name, rule] of Object.entries(rules)) {
    assert.equal(plugin.rules[name], rule)
    assert.equal(plugin.recommended[`starci-fe/${name}`], "error")
    assert.equal(plugin.ruleOwners[name], "swr-family")
    assert.equal(plugin.ruleDeclarations.filter((entry) => entry.name === name).length, 1)
  }
})

test("R285: values generated from the contract's input bounds are data, not operations", (t) => {
  const temporaryRoot = resolve(tmpdir())
  const root = mkdtempSync(join(temporaryRoot, "starci-bounds-api-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const api = join(root, "apps", "web", "src", "modules", "api")
  mkdirSync(join(api, "graphql", "__generated__"), { recursive: true })
  mkdirSync(join(api, "graphql", "queries"), { recursive: true })
  writeFileSync(join(api, "index.ts"), 'export { INPUT_BOUNDS, inputBoundsIssues, queryOrders } from "./graphql"\nexport type { GraphQLResponse } from "./graphql"\n')
  writeFileSync(join(api, "graphql", "index.ts"), 'export { INPUT_BOUNDS, inputBoundsIssues } from "./__generated__/input-bounds"\nexport { queryOrders } from "./queries/query-orders"\n')
  writeFileSync(join(api, "graphql", "__generated__", "input-bounds.ts"), "export const INPUT_BOUNDS = {}\nexport const inputBoundsIssues = () => []\n")
  writeFileSync(join(api, "graphql", "queries", "query-orders.ts"), "export const queryOrders = {}\n")
  const hfs = hfsFromDeclaration(appDeclaration("fe", { apps: [{ name: "web", kind: "next" }] }), root)
  const tester = new RuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs } },
  })
  const form = join(root, "apps/web/src/hooks/rhf/useOrderForm.ts")
  assert.doesNotThrow(() => tester.run("operations-only-in-swr-hooks", operationsOnlyInSwrHooks, {
    valid: [
      { filename: form, code: 'import { INPUT_BOUNDS, inputBoundsIssues } from "@/modules/api"; export const bounds = [INPUT_BOUNDS, inputBoundsIssues]' },
      { filename: form, code: 'import { INPUT_BOUNDS, inputBoundsIssues } from "@/modules/api/graphql"; export const bounds = [INPUT_BOUNDS, inputBoundsIssues]' },
      { filename: form, code: 'import { INPUT_BOUNDS as bounds } from "@/modules/api"; export const own = bounds' },
    ],
    invalid: [
      { filename: form, code: 'import { INPUT_BOUNDS, queryOrders } from "@/modules/api"; export const both = [INPUT_BOUNDS, queryOrders]', errors: [{ messageId: "outside" }] },
      { filename: form, code: 'import { queryOrders } from "@/modules/api"; export const op = queryOrders', errors: [{ messageId: "outside" }] },
      { filename: form, code: 'import * as api from "@/modules/api"; export const all = api', errors: [{ messageId: "outside" }] },
      { filename: form, code: 'import api, { INPUT_BOUNDS } from "@/modules/api"; export const all = [api, INPUT_BOUNDS]', errors: [{ messageId: "outside" }] },
    ],
  }))
})
