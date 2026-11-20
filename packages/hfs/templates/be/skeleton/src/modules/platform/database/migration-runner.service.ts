import { spawn } from "node:child_process"
import { Injectable } from "@nestjs/common"
import { DatabaseError, DatabaseErrorCode } from "./errors/database.error"
import { InjectMigrationCommand } from "./primary.decorators"

/** The process a migration run starts: an executable and its arguments, never a shell line. */
export interface MigrationCommand {
    /** The executable the run starts, looked up on PATH. */
    readonly command: string
    /** The arguments handed to the executable, each one argument (no shell splitting). */
    readonly args: ReadonlyArray<string>
}

/** The managed wrapper that owns the db/migrations schema authority (`npm run db:push`), as npm is named on `platform`. */
export const dbPushCommand = (platform: NodeJS.Platform): MigrationCommand => ({
    command: platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "db:push"],
})

/** The managed wrapper on this host's platform: the process a migration run starts. */
export const DB_PUSH_COMMAND: MigrationCommand = dbPushCommand(process.platform)

/** The refusal of a migration run: the wrapper's exit status, or `none` when it ended without one or could not start. */
const failed = (status: number | null): DatabaseError =>
    new DatabaseError({ code: DatabaseErrorCode.MigrationFailed, params: { status: status ?? "none" } })

@Injectable()
/** The lite migration runner delegates the db/migrations schema authority to the managed db:push wrapper. */
export class MigrationRunnerService {
    constructor(@InjectMigrationCommand() private readonly migration: MigrationCommand) {}

    /** Runs the managed wrapper and propagates a CLI or migration failure as DATABASE_MIGRATION_FAILED. */
    run(): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn(this.migration.command, [...this.migration.args], { stdio: "inherit" })
            child.once("error", () => reject(failed(null)))
            child.once("exit", (code) => (code === 0 ? resolve() : reject(failed(code))))
        })
    }
}
