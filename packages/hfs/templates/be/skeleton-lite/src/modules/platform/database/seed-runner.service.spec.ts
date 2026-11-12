import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Test } from "@nestjs/testing"
import { mockEntityManager } from "@starci/jest-preset"
import { PRIMARY_ENTITY_MANAGER, SEED_ROOT } from "./primary.decorators"
import { SeedRunnerService } from "./seed-runner.service"

/** A scratch app root under the ignored jest cache: the seed files are written per run, never tracked (SQL lives only in db/ and the seed levels). */
const SCRATCH = "node_modules/.cache/seed-runner-spec"

/** Seed files of the scratch roots, relative to SCRATCH. */
const FILES: Readonly<Record<string, string>> = {
    "ordered/.starcistacks/seeds/sql/b.sql": "SELECT 2",
    "ordered/.starcistacks/seeds/sql/a.sql": "SELECT 1",
    "ordered/.starcistacks/seeds/sql/notes.txt": "not run",
    "ordered/.starcistacks/dev/seeds/sql/c.sql": "SELECT 3",
    "ordered/.starcistacks/dev/seeds/sql/empty.sql": "   ",
    "blocked/.starcistacks/seeds/sql": "a file where the sql folder belongs",
}

beforeAll(async () => {
    await rm(SCRATCH, { recursive: true, force: true })
    for (const [path, text] of Object.entries(FILES)) {
        await mkdir(join(SCRATCH, path, ".."), { recursive: true })
        await writeFile(join(SCRATCH, path), text, "utf8")
    }
})

afterAll(async () => {
    await rm(SCRATCH, { recursive: true, force: true })
})

describe("SeedRunnerService", () => {
    it("runs the shared seeds and then the environment's, each level in name order, skipping empty and non-SQL files", async () => {
        const entityManager = mockEntityManager({
            query: [
                ["SELECT 1", []],
                ["SELECT 2", []],
                ["SELECT 3", []],
            ],
        })
        const moduleRef = await Test.createTestingModule({
            providers: [
                SeedRunnerService,
                { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
                { provide: SEED_ROOT, useValue: "node_modules/.cache/seed-runner-spec/ordered" },
            ],
        }).compile()

        await moduleRef.get(SeedRunnerService).run()

        expect(entityManager.query.mock.calls).toEqual([["SELECT 1"], ["SELECT 2"], ["SELECT 3"]])
    })

    it("runs nothing when neither seed folder exists", async () => {
        const entityManager = mockEntityManager()
        const moduleRef = await Test.createTestingModule({
            providers: [
                SeedRunnerService,
                { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
                { provide: SEED_ROOT, useValue: "node_modules/.cache/seed-runner-spec/absent" },
            ],
        }).compile()

        await moduleRef.get(SeedRunnerService).run("production")

        expect(entityManager.query).not.toHaveBeenCalled()
    })

    it("propagates a seed folder that cannot be read", async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                SeedRunnerService,
                { provide: PRIMARY_ENTITY_MANAGER, useValue: mockEntityManager() },
                { provide: SEED_ROOT, useValue: "node_modules/.cache/seed-runner-spec/blocked" },
            ],
        }).compile()

        await expect(moduleRef.get(SeedRunnerService).run()).rejects.toEqual(
            expect.objectContaining({ code: "ENOTDIR" }),
        )
    })
})
