/**
 * Twin tests for the loading-state laws (R367).
 *
 *   node --test src/skeleton-states.spec.ts
 */
// proves: FE_SWR_DEFAULT_ARRAY@lite FE_SWR_DEFAULT_ARRAY@full
// proves: FE_FOREIGN_SLOT_STATUS@lite FE_FOREIGN_SLOT_STATUS@full
// proves: FE_VALIDATING_AS_LOADING@lite FE_VALIDATING_AS_LOADING@full
// proves: FE_PLACEHOLDER_OBJECT@lite FE_PLACEHOLDER_OBJECT@full
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../fixtures/typed/tester.ts"
import { why } from "./lib/why.ts"
import { recommended, rules } from "./skeleton-states.ts"

const tester = slotTester()
const HOOK = at("apps/web/src/hooks/office/useOfficeTeam.ts")
const SWR_HOOK = at("apps/web/src/hooks/swr/useTeamRead.ts")
const BLOCK = at("apps/web/src/components/blocks/OfficeMessenger/index.tsx")

const rule = (name: keyof typeof rules) => rules[name]

test("R367: the rules carry their finding codes and all five are published at error", () => {
  assert.equal(why["no-swr-default-array"].code, "FE_SWR_DEFAULT_ARRAY")
  assert.equal(why["no-foreign-slot-status"].code, "FE_FOREIGN_SLOT_STATUS")
  assert.equal(why["no-validating-as-loading"].code, "FE_VALIDATING_AS_LOADING")
  assert.equal(why["no-placeholder-object"].code, "FE_PLACEHOLDER_OBJECT")
  assert.equal(why["no-hand-skeleton"].code, "FE_HAND_SKELETON")
  assert.deepEqual(Object.keys(recommended).sort(), ["no-foreign-slot-status", "no-hand-skeleton", "no-placeholder-object", "no-swr-default-array", "no-validating-as-loading"].map((name) => `starci-fe/${name}`))
})

test("R367 no-swr-default-array: a hook that folds a read to [] returns that read's status", () => {
  assert.doesNotThrow(() => tester.run("no-swr-default-array", rule("no-swr-default-array"), {
    valid: [
      { filename: HOOK, code: "export const useTeam = () => { const read = useRead(); return { members: read.data ?? [], isLoading: read.isLoading } }" },
      { filename: HOOK, code: "export const useTeam = () => { const { data, isLoading } = useRead(); return { members: data ?? [], isLoading } }" },
      { filename: HOOK, code: "export const useTeam = () => { const read = useRead(); return { members: read.data ?? [], error: read.error } }" },
      { filename: SWR_HOOK, code: "export const useTeamRead = () => { const read = useRead(); return { members: read.data ?? [] } }" },
      { filename: HOOK, code: "export const useTeam = (x) => x.name ?? 'none'" },
    ],
    invalid: [
      { filename: HOOK, code: "export const useTeam = () => { const read = useRead(); return { members: read.data ?? [] } }", errors: [{ messageId: "fold" }] },
      { filename: HOOK, code: "export const useTeam = () => { const { data } = useRead(); return data?.items?.map((i) => i.id) ?? [] }", errors: [{ messageId: "fold" }] },
      { filename: HOOK, code: "export const useTeam = () => { const a = useRead(); const b = useOther(); return { x: a.data ?? [], y: b.data ?? [], isLoading: a.isLoading } }", errors: [{ messageId: "fold" }] },
    ],
  }))
})

test("R367 no-foreign-slot-status: a slot never copies another slot's loading or error", () => {
  assert.doesNotThrow(() => tester.run("no-foreign-slot-status", rule("no-foreign-slot-status"), {
    valid: [
      { filename: BLOCK, code: "const a = (reads) => slotOfReads(reads)" },
      { filename: BLOCK, code: "const a = (read) => ({ isLoading: read.isLoading, isError: read.isError })" },
      { filename: BLOCK, code: "const { isLoading } = office.slot" },
    ],
    invalid: [
      { filename: BLOCK, code: "const list = { items, isLoading: office.slot.isLoading }", errors: [{ messageId: "foreign" }] },
      { filename: BLOCK, code: "const list = (slot) => ({ items, isError: slot.isError, error: slot.error })", errors: [{ messageId: "foreign" }, { messageId: "foreign" }] },
    ],
  }))
})

test("R367 no-validating-as-loading: a refresh never drives a loading flag or a status", () => {
  assert.doesNotThrow(() => tester.run("no-validating-as-loading", rule("no-validating-as-loading"), {
    valid: [
      { filename: HOOK, code: "export const useRange = () => { const r = useRead(); return { isLoading: r.isLoading, isRefreshing: r.isValidating } }" },
      { filename: BLOCK, code: "const suffix = range.isValidating ? 'loading' : ''" },
    ],
    invalid: [
      { filename: HOOK, code: "export const useRange = () => { const r = useRead(); return { isLoading: r.isLoading || r.isValidating } }", errors: [{ messageId: "validating" }] },
      { filename: HOOK, code: "export const useRange = (r) => { const isLoading = r.isValidating; return isLoading }", errors: [{ messageId: "validating" }] },
      { filename: HOOK, code: "export const useRange = (r) => ({ status: r.isValidating ? 'loading' : 'ready' })", errors: [{ messageId: "validating" }] },
    ],
  }))
})

test("R367 no-placeholder-object: a placeholder is not the ready data with its lists emptied", () => {
  assert.doesNotThrow(() => tester.run("no-placeholder-object", rule("no-placeholder-object"), {
    valid: [
      { filename: BLOCK, code: "const a = { listPlaceholder: undefined }" },
      { filename: BLOCK, code: "const a = { listPlaceholder: { title: 'x' } }" },
      { filename: BLOCK, code: "const a = { rows: [] }" },
      // The recipe form (FE-ERROR-1): a lowercase placeholder prop or call argument, and an upper-case constant of same-shape rows.
      { filename: BLOCK, code: "const a = () => <SlotView slot={slot} placeholder={EVENTS_PLACEHOLDER} render={(rows, isLoading) => draw(rows, isLoading)} />" },
      { filename: BLOCK, code: "const EVENTS_PLACEHOLDER = [{ id: 'a', title: ' ' }]; const b = (placeholder) => render(placeholder, true)" },
    ],
    invalid: [
      { filename: BLOCK, code: "const a = { listPlaceholder: { ...panel, conversations: [] } }", errors: [{ messageId: "placeholder" }] },
      { filename: BLOCK, code: "const threadPlaceholder = { ...thread, items: [], typing: '' }", errors: [{ messageId: "placeholder" }] },
    ],
  }))
})

test("R367 no-hand-skeleton: an app draws no skeleton by hand", () => {
  assert.doesNotThrow(() => tester.run("no-hand-skeleton", rule("no-hand-skeleton"), {
    valid: [
      { filename: BLOCK, code: "const a = () => <Section isLoading />" },
      // The block recipe (FE-ERROR-1): a lowercase `placeholder` prop and the ready tree drawn once with isLoading.
      { filename: BLOCK, code: "const a = () => <SlotView slot={slot} placeholder={ROWS_PLACEHOLDER_ITEMS} render={(rows, isLoading) => <DataTable rows={rows} isLoading={isLoading} />} />" },
    ],
    invalid: [
      { filename: BLOCK, code: "const a = () => <Skeleton className='h-4' />", errors: [{ messageId: "hand" }] },
      { filename: BLOCK, code: "const a = () => <ChatBubbleSkeletons count={3} />", errors: [{ messageId: "hand" }] },
    ],
  }))
})
