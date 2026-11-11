import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { DatabaseErrorCode } from "./errors/database.error"
import { DB_PUSH_COMMAND, type MigrationCommand, MigrationRunnerService } from "./migration-runner.service"
import { MIGRATION_COMMAND } from "./primary.decorators"

/** Real node processes the runner starts exactly as it starts the managed wrapper. */
const SUCCEEDS = mock<MigrationCommand>({ command: process.execPath, args: ["-e", "process.exit(0)"] })
const FAILS = mock<MigrationCommand>({ command: process.execPath, args: ["-e", "process.exit(3)"] })
const MISSING = mock<MigrationCommand>({ command: "starci-no-such-command", args: [] })

/** What a run settles with: null when it resolved, else the refusal. */
const settled = (run: Promise<void>): Promise<unknown> =>
    run.then(
        () => null,
        (error: unknown) => error,
    )

const runnerWith = async (command: MigrationCommand): Promise<MigrationRunnerService> => {
    const moduleRef = await Test.createTestingModule({
        providers: [MigrationRunnerService, { provide: MIGRATION_COMMAND, useValue: command }],
    }).compile()
    return moduleRef.get(MigrationRunnerService)
}

describe("MigrationRunnerService", () => {
    it("names the managed db:push wrapper as the process of a migration run", () => {
        expect(DB_PUSH_COMMAND.args).toEqual(["run", "db:push"])
    })

    it("resolves when the process exits with status 0", async () => {
        const runner = await runnerWith(SUCCEEDS)

        await expect(settled(runner.run())).resolves.toBeNull()
    })

    it("refuses with DATABASE_MIGRATION_FAILED and the status when the process fails", async () => {
        const runner = await runnerWith(FAILS)

        await expect(settled(runner.run())).resolves.toEqual(
            expect.objectContaining({ code: DatabaseErrorCode.MigrationFailed, params: { status: 3 } }),
        )
    })

    it("refuses with DATABASE_MIGRATION_FAILED when the process cannot start", async () => {
        const runner = await runnerWith(MISSING)

        await expect(settled(runner.run())).resolves.toEqual(
            expect.objectContaining({ code: DatabaseErrorCode.MigrationFailed, params: { status: "none" } }),
        )
    })
})
