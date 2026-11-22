import { expect, test, type Page } from "@playwright/test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { measure, type Positions } from "./shared/collision.ts"

/** The flows of the demo, each in every state mix, and the other stories; each may have this many edge crossings (the default is 0). */
const FLOWS = ["order-approval", "wait-person", "wait-time", "wait-external", "error-reason", "linear", "branch-merge", "nested-branch", "loop", "loop-two-exits", "parallel", "long-labels", "wait-loops", "big"] as const
const MIXES = ["todo", "running", "waiting", "error", "done"] as const
const OTHERS = ["containers", "islands", "schema", "legend", "editable", "decision", "edges", "states", "vertical"] as const
const CROSSINGS: Readonly<Record<string, number>> = { "nested-branch": 1, "wait-loops": 2, states: 1, editable: 1, edges: 1 }
const SNAPSHOT = join(import.meta.dirname, "positions.snap.json")

const open = async (page: Page, query: string): Promise<void> => {
    await page.goto(`/?${query}&theme=light`)
    await page.locator(".react-flow__node").first().waitFor()
    await page.waitForTimeout(600)
}

const committed: Record<string, Positions> = existsSync(SNAPSHOT) ? (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, Positions>) : {}
const taken: Record<string, Positions> = {}

const cases = [
    ...FLOWS.flatMap((id) => MIXES.map((mix) => ({ name: `${id} ${mix}`, query: `story=${id}&mix=${mix}`, crossings: CROSSINGS[id] ?? 0 }))),
    ...OTHERS.map((id) => ({ name: id, query: `story=${id}`, crossings: CROSSINGS[id] ?? 0 })),
]

for (const item of cases) {
    test(`layout spec: ${item.name}`, async ({ page }) => {
        await open(page, item.query)
        const first = await measure(page, item.crossings)
        expect(first.hits).toEqual([])
        // 10: the same input gives the same coordinates again, and the ones in the committed snapshot
        await open(page, item.query)
        expect((await measure(page, item.crossings)).positions).toEqual(first.positions)
        taken[item.name] = first.positions
        if (process.env.UPDATE_SNAPSHOT === undefined) expect(committed[item.name], `no snapshot for ${item.name}; run once with UPDATE_SNAPSHOT=1`).toEqual(first.positions)
    })
}

test.afterAll(() => {
    if (process.env.UPDATE_SNAPSHOT !== undefined) writeFileSync(SNAPSHOT, `${JSON.stringify({ ...committed, ...taken }, null, 1)}\n`)
})
