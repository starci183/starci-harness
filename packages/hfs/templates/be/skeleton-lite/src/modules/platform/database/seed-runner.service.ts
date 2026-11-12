import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { isRecord } from "@modules/platform/primitives"
import { InjectPrimaryEntityManager, InjectSeedRoot } from "./primary.decorators"

/** The folder seed paths are relative to: the app root the run starts from. */
export const SEED_ROOT_DEFAULT = "."

/** The stack environment whose seed runs when `--env` is not given. */
export const DEFAULT_SEED_ENV = "dev"

/**
 * The SQL seed folder of a seed level under `root`: the shared level every environment runs first
 * (`.starcistacks/seeds/sql`) when no environment is named, else the environment's own (`.starcistacks/<env>/seeds/sql`).
 */
const seedDirectoryOf = (root: string, env?: string): string =>
    env === undefined ? join(root, ".starcistacks", "seeds", "sql") : join(root, ".starcistacks", env, "seeds", "sql")

/** The `*.sql` files of a seed folder in name order; a folder that is absent holds none. */
const seedFilesOf = async (directory: string): Promise<ReadonlyArray<string>> => {
    try {
        const names = await readdir(directory)
        return names
            .filter((name) => name.endsWith(".sql"))
            .sort((a, b) => a.localeCompare(b))
            .map((name) => join(directory, name))
    } catch (error) {
        if (isRecord(error) && error["code"] === "ENOENT") return []
        throw error
    }
}

@Injectable()
/** Executes the tracked SQL seeds, the shared level and then the environment's own, through the shared least-privilege EntityManager. */
export class SeedRunnerService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectSeedRoot() private readonly root: string,
    ) {}

    /** Runs every SQL seed of the shared level, then of the environment (dev when none is named), in name order; an empty file runs nothing. */
    async run(env: string = DEFAULT_SEED_ENV): Promise<void> {
        const files = [
            ...(await seedFilesOf(seedDirectoryOf(this.root))),
            ...(await seedFilesOf(seedDirectoryOf(this.root, env))),
        ]
        await files.reduce<Promise<void>>((done, file) => done.then(() => this.apply(file)), Promise.resolve())
    }

    private async apply(file: string): Promise<void> {
        const text = await readFile(file, "utf8")
        if (text.trim() !== "") await this.entityManager.query(text)
    }
}
