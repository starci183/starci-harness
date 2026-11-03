import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import type { SqlText } from "./database.sql"
import { InjectPrimaryEntityManager } from "./primary.decorators"

/** The stack environment whose seed runs when `--env` is not given. */
export const DEFAULT_SEED_ENV = "dev"

/**
 * The SQL seed folder of a seed level, relative to the app root the run starts from: the shared level every environment runs first
 * (`.starcistacks/seeds/sql`) when no environment is named, else the environment's own (`.starcistacks/<env>/seeds/sql`).
 */
export const seedDirectoryOf = (env?: string): string =>
    env === undefined ? join(".starcistacks", "seeds", "sql") : join(".starcistacks", env, "seeds", "sql")

function assertSeedText(_text: string): asserts _text is SqlText {
    // The brand is compile-time only; this function's caller reads a tracked seed file verbatim.
}

const seedText = (text: string): SqlText => {
    assertSeedText(text)
    return text
}

/** The `*.sql` files of a seed folder in name order; a folder that is absent holds none. */
const seedFilesOf = async (directory: string): Promise<ReadonlyArray<string>> => {
    try {
        const names = await readdir(directory)
        return names.filter((name) => name.endsWith(".sql")).sort((a, b) => a.localeCompare(b)).map((name) => join(directory, name))
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
        throw error
    }
}

@Injectable()
/** Executes the tracked SQL seeds, the shared level and then the environment's own, through the shared least-privilege EntityManager. */
export class SeedRunnerService {
    constructor(@InjectPrimaryEntityManager() private readonly entityManager: EntityManager) {}

    /** Runs every SQL seed of the shared level, then of the environment (dev when none is named), in name order; an empty file runs nothing. */
    async run(env: string = DEFAULT_SEED_ENV): Promise<void> {
        const files = [...(await seedFilesOf(seedDirectoryOf())), ...(await seedFilesOf(seedDirectoryOf(env)))]
        await files.reduce<Promise<void>>((done, file) => done.then(() => this.apply(file)), Promise.resolve())
    }

    private async apply(file: string): Promise<void> {
        const text = seedText(await readFile(file, "utf8"))
        if (text.trim() !== "") await this.entityManager.query(text)
    }
}
