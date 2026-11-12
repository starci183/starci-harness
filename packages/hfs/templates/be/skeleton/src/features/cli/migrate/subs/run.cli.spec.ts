import { mock } from "@starci/jest-preset"
import { Test } from "@nestjs/testing"
import { MigrationRunnerService } from "@modules/platform/database"
import { MigrateRunCli } from "./run.cli"

describe("MigrateRunCli", () => {
    it("delegates the migration run to the migration runner once", async () => {
        const migrations = mock<MigrationRunnerService>()
        const moduleRef = await Test.createTestingModule({
            providers: [MigrateRunCli, { provide: MigrationRunnerService, useValue: migrations }],
        }).compile()

        await expect(moduleRef.get(MigrateRunCli).run()).resolves.toBeUndefined()

        expect(migrations.run).toHaveBeenCalledTimes(1)
    })
})
