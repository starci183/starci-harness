import { Test } from "@nestjs/testing"
import { mockEntityManager } from "@starci/jest-preset"
import { advisoryXactLock, callDbFunction, notify } from "./database.client"
import { DatabaseError, DatabaseErrorCode } from "./errors/database.error"

const DATABASE_CLIENT = Symbol("database-client")

const setup = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: DATABASE_CLIENT, useFactory: () => ({ advisoryXactLock, callDbFunction, notify }) }],
    }).compile()
    return moduleRef.get<{
        readonly advisoryXactLock: typeof advisoryXactLock
        readonly callDbFunction: typeof callDbFunction
        readonly notify: typeof notify
    }>(DATABASE_CLIENT)
}

/** What `callDbFunction` throws for `name`, or null when it builds a call. */
const refusalOf = async (name: string): Promise<unknown> => {
    const client = await setup()
    try {
        await client.callDbFunction(mockEntityManager({ query: ['SELECT * FROM "public"."never"()', []] }), name, [])
        return null
    } catch (error) {
        return error
    }
}

describe("callDbFunction", () => {
    it("calls a schema-qualified function with each part quoted and the arguments as numbered parameters", async () => {
        const client = await setup()
        const manager = mockEntityManager({ query: ['SELECT * FROM "public"."job_claim"($1, $2)', [{ id: "job-1" }]] })

        const rows = await client.callDbFunction<{ id: string }>(manager, "public.job_claim", ["mail", 3])

        expect(rows).toEqual([{ id: "job-1" }])
        expect(manager.query).toHaveBeenCalledWith('SELECT * FROM "public"."job_claim"($1, $2)', ["mail", 3])
    })

    it("calls a bare pg built-in of the canon's list in pg_catalog", async () => {
        const client = await setup()
        const manager = mockEntityManager({ query: ['SELECT * FROM "pg_catalog"."to_regproc"($1)', [{ to_regproc: null }]] })

        const rows = await client.callDbFunction<{ to_regproc: string | null }>(manager, "to_regproc", ["public.job_claim"])

        expect(rows).toEqual([{ to_regproc: null }])
    })

    it("calls a function of another schema with no arguments", async () => {
        const client = await setup()
        const manager = mockEntityManager({ query: ['SELECT * FROM "be_access"."chat_target_member"()', []] })

        const rows = await client.callDbFunction(manager, "be_access.chat_target_member", [])

        expect(rows).toEqual([])
    })

    it.each([
        ["a bare name that is not a listed built-in", "job_claim"],
        ["a pg_catalog name spelt out", "pg_catalog.pg_terminate_backend"],
        ["a quote inside a part", 'public."job_claim'],
        ["a second statement smuggled into the name", "public.job_claim(); SELECT 1; --"],
        ["an upper-case part", "public.Job_Claim"],
        ["three parts", "db.public.job_claim"],
        ["an empty schema", ".job_claim"],
        ["an empty name", ""],
    ])("refuses %s before any SQL runs", async (_case, name) => {
        const refusal = await refusalOf(name)

        expect(refusal).toBeInstanceOf(DatabaseError)
        expect(refusal).toMatchObject({ code: DatabaseErrorCode.IdentifierRejected, params: { name } })
    })
})

describe("advisoryXactLock", () => {
    it("locks the 64-bit hash of the key for the transaction", async () => {
        const client = await setup()
        const manager = mockEntityManager({ query: ["SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [{}]] })

        await expect(client.advisoryXactLock(manager, "jobs:mail")).resolves.toBeUndefined()

        expect(manager.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["jobs:mail"])
    })
})

describe("notify", () => {
    it("sends the payload on the channel", async () => {
        const client = await setup()
        const manager = mockEntityManager({ query: ["SELECT pg_notify($1, $2)", [{}]] })

        await expect(client.notify(manager, "jobs", '{"id":"job-1"}')).resolves.toBeUndefined()

        expect(manager.query).toHaveBeenCalledWith("SELECT pg_notify($1, $2)", ["jobs", '{"id":"job-1"}'])
    })
})
