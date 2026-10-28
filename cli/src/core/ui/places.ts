import { basename } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { findLedgerId, openExistingLedger } from "../../harness/ledger.js"
import { inOrder } from "../../harness/sequential.js"
import { projectOf } from "../../harness/work.js"
import type { Project } from "../../harness/work.js"
import { Refusal } from "../../shared/errors.js"
import { registeredRepositories } from "../../harness/project-workers.js"

/** A registered repository with the project it belongs to: the ledger every read and write of the server opens. */
export interface Place {
    readonly project: Project
    readonly repo: string
}

/**
 * Every repository the host registry lists, with its project (`projectOf`, minting nothing). A repository whose project cannot be
 * resolved, or whose owner is not registered, stands as a project of its own, keyed by its own ledger id.
 */
export const places = async (): Promise<Place[]> =>
    inOrder(registeredRepositories(), async (repo): Promise<Place> => {
        const own: Project = { root: repo, key: findLedgerId(repo) ?? repo, name: basename(repo) }
        try {
            const project = await projectOf(repo, false)
            return { project: project.key === "" ? own : project, repo }
        } catch {
            return { project: own, repo }
        }
    })

/** Every distinct project of the places, in registry order. */
export const projectsOf = (all: readonly Place[]): Project[] => [...new Map(all.map((place) => [place.project.key, place.project])).values()]

/** Reads a repository's ledger when it has one; `empty` when it has none. */
export const readLedger = <T>(repo: string, work: (db: DatabaseSync) => T, empty: T): T => {
    const db = openExistingLedger(repo)
    if (db === undefined) return empty
    try {
        return work(db)
    } finally {
        db.close()
    }
}

/**
 * The repository of a project whose ledger `holds` says has the subject (a workflow, a task, a decision); refuses `code` when
 * no repository of the project does.
 */
export const placeHolding = (all: readonly Place[], project: string, holds: (db: DatabaseSync) => boolean, code: string, what: string): Place => {
    const found = all.filter((place) => place.project.key === project).find((place) => readLedger(place.repo, holds, false))
    if (found === undefined) throw new Refusal(code, `no ${what} in project ${project}`)
    return found
}
