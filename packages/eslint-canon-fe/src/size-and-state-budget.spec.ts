/**
 * Twin tests for the size and state budget rules (HFS R65).
 *
 *   node --test src/size-and-state-budget.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { Linter } from "eslint"
import { at, fixtureHfs, slotTester, typedTester } from "../fixtures/typed/tester.ts"
import { eslintPlugin } from "./lib/eslint-boundary.ts"
import type { HfsView } from "./lib/hfs.ts"
import {
  componentLineBudget,
  noAppRelativeClock,
  noHandRolledPolling,
  rules,
  unitHookBudget,
} from "./size-and-state-budget.ts"

const tester = slotTester()

const BLOCK = at("apps/web/src/components/blocks/Feed/index.tsx")
const DRAWING = at("apps/web/src/components/blocks/Feed/component.tsx")
const HOOK = at("apps/web/src/hooks/feed/useFeed.ts")
const BARREL = at("apps/web/src/hooks/feed/index.ts")

// The budgets are the slot manifest's own numbers: the rule keeps no copy.
/** The number a slot's budget states for `key`, read from the manifest as stated; a missing one fails the case. */
const budgetNumber = (hfs: HfsView, id: string, key: string): number => {
  const slot = hfs.slot(id)
  const budget: unknown = slot === null ? undefined : Reflect.get(slot, "budget")
  const value: unknown = typeof budget === "object" && budget !== null ? Reflect.get(budget, key) : undefined
  if (typeof value !== "number") throw new TypeError(`slot ${id} states no ${key} budget`)
  return value
}
const COMPONENTS = (key: string): number => budgetNumber(fixtureHfs(), "fe.components", key)
const FEATURE = (key: string): number => budgetNumber(fixtureHfs(), "fe.feature", key)

/** `count` lines of code that do nothing. */
const lines = (count: number): string => Array.from({ length: count }, (_, index) => `const line${index} = ${index}`).join("\n")

/** A barrel whose named, type-only, star and namespace statements all re-export from another file. */
const reExports = (count: number): string => Array.from({ length: count }, (_, index) => [
  `export { value${index} } from "./value${index}"`,
  `export type { Value${index} } from "./value${index}"`,
  `export * from "./value${index}"`,
  `export * as values${index} from "./value${index}"`,
  `export type * from "./value${index}"`,
][index % 5]).join("\n")

/** A component with `states` useState calls and `data` data hooks. */
const unit = (name: string, states: number, data: number): string =>
  `export const ${name} = () => {\n${Array.from({ length: states }, (_, i) => `  const [s${i}, set${i}] = useState(0)`).join("\n")}\n${Array.from({ length: data }, (_, i) => `  const d${i} = useQueryFeed${i}Swr()`).join("\n")}\n  return null\n}`

test("every rule this law declares is a rule", () => {
  for (const [name, rule] of Object.entries(rules)) assert.ok(rule && rule.meta && rule.create, `${name} is not a rule`)
})

test("BUDGET-1: a component file stays within the line budget its slot states for its role", () => {
  assert.deepEqual([COMPONENTS("component.tsx"), COMPONENTS("index.tsx")], [300, 200])
  tester.run("component-line-budget", componentLineBudget, {
    valid: [
      { filename: DRAWING, code: lines(300) },
      { filename: DRAWING, code: `${lines(300)}
` },
      { filename: BLOCK, code: lines(200) },
      { filename: at("apps/web/src/features/pages/Home/component.tsx"), code: lines(FEATURE("component.tsx")) },
      // a hook and a module are held by the `file` budget of their slot (200, 400)
      { filename: HOOK, code: lines(200) },
      { filename: at("apps/web/src/modules/feed/index.ts"), code: lines(400) },
      { filename: at("apps/web/src/modules/config/index.ts"), code: lines(400) },
      // a file the slots do not put in a component owner is not judged by this rule
      { filename: at("apps/web/src/modules/components/x.tsx"), code: lines(400) },
      { filename: at("apps/web/src/lib/Big.tsx"), code: lines(400) },
      // a component owner's styling file has no line budget of its own
      { filename: at("apps/web/src/components/blocks/Feed/classNames.ts"), code: lines(400) },
    ],
    invalid: [
      { filename: HOOK, code: lines(201), errors: [{ messageId: "lines", data: { count: 201, max: 200 } }] },
      { filename: at("apps/web/src/modules/feed/index.ts"), code: lines(401), errors: [{ messageId: "lines", data: { count: 401, max: 400 } }] },
      { filename: at("packages/shop-ui/src/leaves/Chip/component.tsx"), code: lines(301), errors: [{ messageId: "lines" }] },
      { filename: DRAWING, code: lines(301), errors: [{ messageId: "lines", data: { count: 301, max: 300 } }] },
      // the connected entry has the smaller budget
      { filename: BLOCK, code: lines(201), errors: [{ messageId: "lines", data: { count: 201, max: 200 } }] },
      { filename: at("apps/web/src/features/pages/Home/index.tsx"), code: lines(650), errors: [{ messageId: "lines" }] },
      { filename: at("apps/admin/src/features/overlays/Confirm/component.tsx"), code: lines(301), errors: [{ messageId: "lines" }] },
      // a layer folder named like a component still gets its budget from the slot
      { filename: at("apps/web/src/components/leaves/blocks/index.tsx"), code: lines(201), errors: [{ messageId: "lines" }] },
    ],
  })
})

test("BUDGET-1: only a pure re-export index.ts gets the separate barrel budget", () => {
  const hfs = fixtureHfs()
  const slots = ["fe.hooks", "fe.hooks.swr", "fe.hooks.rhf", "fe.hooks.zustand", "fe.hooks.socketio", "fe.hooks.effects", "fe.hooks.reuseables"]
  for (const id of slots) assert.equal(budgetNumber(hfs, id, "barrel"), 400, id)
  const max = budgetNumber(hfs, "fe.hooks", "barrel")
  const ordinary = budgetNumber(hfs, "fe.hooks", "file")
  const overOrdinary = { messageId: "lines", data: { count: ordinary + 1, max: ordinary } }
  tester.run("component-line-budget", componentLineBudget, {
    valid: [
      { filename: BARREL, code: reExports(max) },
      { filename: BARREL, code: `// public surface\n${reExports(max - 1)}\n` },
      { filename: BARREL, code: `${reExports(max - 4)}\nexport {\n  value as renamed,\n  type Value,\n} from "./other"` },
      ...["swr", "rhf", "zustand/session", "socketio", "effects", "reuseables"].map((domain) =>
        ({ filename: at(`apps/web/src/hooks/${domain}/index.ts`), code: reExports(max) })),
      { filename: at("apps/web/src/hooks/swr/api/graphql/queries/index.ts"), code: reExports(max) },
      // Slots already allowing 400 lines keep that budget without stating a separate barrel limit.
      { filename: at("apps/web/src/modules/feed/index.ts"), code: reExports(max) },
      { filename: BARREL, code: `${reExports(ordinary - 1)}\nexport const local = 1` },
    ],
    invalid: [
      { filename: BARREL, code: reExports(max + 1), errors: [{ messageId: "lines", data: { count: max + 1, max } }] },
      ...["export const local = 1", "import { value } from './other'", "export { value as local }", "export default 1", "'use client'", ";;"].map((statement) =>
        ({ filename: BARREL, code: `${reExports(ordinary)}\n${statement}`, errors: [overOrdinary] })),
      // An empty statement body, another basename or index.tsx keeps the ordinary slot/role limit.
      { filename: BARREL, code: Array(ordinary + 1).fill("// comment").join("\n"), errors: [overOrdinary] },
      { filename: HOOK, code: reExports(ordinary + 1), errors: [overOrdinary] },
      { filename: BLOCK, code: reExports(ordinary + 1), errors: [overOrdinary] },
    ],
  })
})

test("BUDGET-1: malformed export syntax is a parser failure", () => {
  const messages = new Linter().verify(`${reExports(200)}\nexport { missing } from`, [{
    files: ["**/*.ts"],
    languageOptions: { parser: tsParser },
    settings: { starci: { hfs: fixtureHfs() } },
    plugins: { budget: eslintPlugin({ meta: { name: "budget" }, rules: { lines: componentLineBudget } }) },
    rules: { "budget/lines": "error" },
  }], { filename: BARREL })
  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.fatal, true)
})

test("BUDGET-2: a unit holds at most six state hooks and six data hooks", () => {
  assert.doesNotThrow(() => tester.run("unit-hook-budget", unitHookBudget, {
    valid: [
      { filename: BLOCK, code: unit("Feed", 6, 6) },
      { filename: BLOCK, code: unit("Feed", 0, 0) },
      // two small units in one file do not add up
      { filename: BLOCK, code: `${unit("A", 4, 4)}\n${unit("B", 4, 4)}` },
      // a callback that is not a unit does not own the calls
      { filename: BLOCK, code: "export const Feed = () => { const a = items.map(() => 1); const [x] = useState(0); return a }" },
      // a slot that states no useState / dataHooks budget puts no bound on the count (hooks, features, modules)
      { filename: HOOK, code: unit("useFeed", 6, 6) },
      { filename: at("apps/web/src/modules/feed/index.ts"), code: unit("Feed", 9, 9) },
      // a file no slot owns is not judged
      { filename: at("apps/web/src/lib/x.tsx"), code: unit("Feed", 9, 9) },
    ],
    invalid: [
      { filename: BLOCK, code: unit("Feed", 7, 0), errors: [{ messageId: "state" }] },
      { filename: HOOK, code: unit("useFeed", 7, 0), errors: [{ messageId: "state" }] },
      { filename: at("packages/shop-ui/src/leaves/Chip/index.tsx"), code: unit("Chip", 0, 7), errors: [{ messageId: "data" }] },
      { filename: BLOCK, code: unit("Feed", 0, 7), errors: [{ messageId: "data" }] },
      { filename: BLOCK, code: unit("Feed", 8, 8), errors: [{ messageId: "state" }, { messageId: "data" }] },
      { filename: at("apps/admin/src/components/leaves/Chip/component.tsx"), code: unit("Chip", 7, 0), errors: [{ messageId: "state" }] },
      {
        filename: BLOCK,
        code: "export function Feed() { const a = useState(0); const b = useState(0); const c = useState(0); const d = useState(0); const e = useState(0); const f = useState(0); const g = React.useState(0); return null }",
        errors: [{ messageId: "state" }],
      },
    ],
  }))
})

test("BUDGET-3: no hand-rolled polling loop", () => {
  assert.doesNotThrow(() => typedTester().run("no-hand-rolled-polling", noHandRolledPolling, {
    valid: [
      { filename: BLOCK, code: "declare const useQueryFeedSwr: (o: object) => unknown\nconst E = () => { const d = useQueryFeedSwr({ refreshInterval: 5000 }); return d }" },
      // a one-shot delay is not a loop
      { filename: BLOCK, code: "import { useEffect } from \"react\"\ndeclare const setOpen: (v: boolean) => void\nconst E = () => { useEffect(() => { const t = setTimeout(() => setOpen(false), 300); return () => clearTimeout(t) }, []) }" },
      // a shared clock ticking the time for labels reads no data (apps/app/src/hooks/time/useNow.ts)
      {
        filename: at("apps/web/src/hooks/time/useNow.ts"),
        code: "import { useSyncExternalStore } from \"react\"\nconst listeners = new Set<() => void>()\nlet instant: number | null = null\nlet timer: ReturnType<typeof setInterval> | undefined\nconst tick = () => {\n  instant = Date.now()\n  for (const listener of listeners) listener()\n}\nconst subscribe = (listener: () => void): (() => void) => {\n  listeners.add(listener)\n  if (timer === undefined) timer = setInterval(tick, 60_000)\n  return () => { listeners.delete(listener); if (listeners.size === 0 && timer !== undefined) { clearInterval(timer); timer = undefined } }\n}\nexport const useNow = (): number | null => useSyncExternalStore(subscribe, () => instant ?? Date.now())",
      },
      // a countdown that only sets state
      { filename: HOOK, code: "import { useEffect, useState } from \"react\"\nexport const useCountdown = () => { const [n, setN] = useState(10); useEffect(() => { const t = setInterval(() => setN((v) => v - 1), 1000); return () => clearInterval(t) }, []); return n }" },
      // a self-scheduling animation step that reads no data
      { filename: HOOK, code: "declare const step: () => void\nfunction frame() { setTimeout(() => { step(); frame() }, 16) }" },
    ],
    invalid: [
      // the callback fetches, directly or through a same-file function
      { filename: BLOCK, code: "import { useEffect } from \"react\"\nconst load = async () => { await fetch(\"/feed\") }\nconst E = () => { useEffect(() => { const t = setInterval(load, 5000); return () => clearInterval(t) }, []) }", errors: [{ messageId: "interval" }] },
      { filename: BLOCK, code: "declare const load: () => Promise<void>\nconst t = window.setInterval(() => { void load() }, 5000)", errors: [{ messageId: "interval" }] },
      // SWR's mutate is a revalidation: a timer that calls it is a second refresh mechanism
      { filename: HOOK, code: "import useSWR from \"swr\"\nexport const useFeed = () => { const { mutate } = useSWR(\"/feed\"); setInterval(() => { void mutate() }, 4000) }", errors: [{ messageId: "interval" }] },
      { filename: HOOK, code: "declare const load: () => Promise<void>\nfunction poll() { setTimeout(() => { void load(); poll() }, 3000) }", errors: [{ messageId: "timeout" }] },
      { filename: HOOK, code: "const poll = async () => { await fetch(\"/x\"); setTimeout(function () { poll() }, 3000) }", errors: [{ messageId: "timeout" }] },
    ],
  }))
})

test("live time and countdowns use the Grammar clock while non-clock timers remain available", () => {
  const FEATURE = at("apps/web/src/features/pages/home/component.tsx")
  const LEAF = at("apps/web/src/components/leaves/UpdatedAt/index.tsx")
  const HOOK = at("apps/web/src/hooks/time/useNow.ts")
  const MODULE = at("apps/web/src/modules/time/index.ts")
  const clock = [{ messageId: "clock" }]
  assert.doesNotThrow(() => slotTester().run("no-app-relative-clock", noAppRelativeClock, {
    valid: [
      { filename: FEATURE, code: 'import { RelativeTime } from "@starci/grammar/common"; export const A = () => <RelativeTime dateTime="2026-10-25T13:00:00Z" locale="en" mode="countdown" format="digital" template="Offer ends in {time}" expiredLabel="Offer expired" fallback="Loading" />' },
      { filename: FEATURE, code: 'import { DropdownMenu, RelativeTime, WorkspaceShell } from "@starci/grammar/core"; const entries = [{ id: "workspace", label: "Workspace", mark: <Logo /> }]; export const A = () => <WorkspaceShell navigation={<Nav />} navigationLabel="Navigation" primaryLabel="Workspace" navigationDrawer={{ defaultOpen: false, title: "Navigation", openLabel: "Open navigation", closeLabel: "Close navigation", source: MenuGlyph, content: <Nav /> }} primary={<><DropdownMenu entries={entries} trigger={<Trigger />} /><RelativeTime dateTime="2026-10-25T12:00:00Z" locale="en" mode="relative" /><RelativeTime dateTime="2026-10-25T13:00:00Z" locale="en" mode="countdown" fallback="Pending" size="sm" tone="muted" /></>} />' },
      { filename: LEAF, code: 'import { RelativeTime } from "@starci/grammar/core"; export const UpdatedAt = () => <RelativeTime dateTime="2026-10-25T12:00:00Z" locale="en" />' },
      { filename: LEAF, code: 'import * as Grammar from "@starci/grammar/core"; export const UpdatedAt = () => <Grammar.RelativeTime dateTime="2026-10-25T12:00:00Z" locale="en" mode="countdown" />' },
      { filename: HOOK, code: "const timer = setInterval(() => step(), 16); const stop = () => clearInterval(timer)" },
      { filename: FEATURE, code: "const later = setTimeout(() => show(Date.now()), 1000)" },
      { filename: MODULE, code: "const parse = () => new Date('2026-10-25T12:00:00Z'); setInterval(() => show(parse()), 1000)" },
      { filename: HOOK, code: "const setInterval = (callback: () => void) => callback(); setInterval(() => show(Date.now()))" },
      { filename: HOOK, code: "const window = { setInterval: (callback: () => void) => callback() }; window.setInterval(() => show(Date.now()))" },
      { filename: HOOK, code: "const Date = { now: () => 5 }; setInterval(() => show(Date.now()), 1000)" },
      { filename: at("scripts/render.tsx"), code: "setInterval(() => show(Date.now()), 1000)" },
    ],
    invalid: [
      { filename: LEAF, code: "setInterval(() => show(Date.now()), 1000)", errors: clock },
      { filename: HOOK, code: "const tick = () => show(Date.now()); window.setInterval(tick, 1000)", errors: clock },
      { filename: MODULE, code: "globalThis.setInterval(() => show(new Date()), 1000)", errors: clock },
      { filename: HOOK, code: "self.setInterval(() => show(Date()), 1000)", errors: clock },
      { filename: HOOK, code: "setInterval(() => show(performance.now()), 1000)", errors: clock },
      { filename: HOOK, code: "const repeat = window.setInterval; const now = Date.now; repeat(() => show(now()), 1000)", errors: clock },
      { filename: HOOK, code: "const { setInterval: repeat } = globalThis; const { now } = Date; repeat(() => show(now()), 1000)", errors: clock },
      { filename: HOOK, code: "const { now: instant } = window.performance; const repeat = self['setInterval']; repeat(() => show(instant()), 1000)", errors: clock },
      { filename: HOOK, code: "const Clock = Date; setInterval(() => show(new Clock()), 1000)", errors: clock },
      { filename: HOOK, code: "const instant = () => Date.now(); const tick = () => show(instant()); setInterval(tick, 1000)", errors: clock },
      { filename: HOOK, code: "function tick() { show(Date.now()); setTimeout(tick, 1000) }", errors: clock },
      { filename: HOOK, code: "const tick = () => { setTimeout(() => { show(Date.now()); tick() }, 1000) }", errors: clock },
      { filename: HOOK, code: "function tick() { show(Date.now()); window.setTimeout(() => tick(), 1000) }", errors: clock },
      { filename: at("packages/other/src/time.ts"), code: "setInterval(() => show(Date.now()), 1000)", errors: clock },
      { filename: at("packages/nivo-ui/src/leaves/RelativeTime/index.tsx"), code: "const timer = setInterval(() => show(Date.now()), 1000)", errors: clock },
    ],
  }))
})
