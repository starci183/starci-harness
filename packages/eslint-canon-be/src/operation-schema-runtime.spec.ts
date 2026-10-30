// proves: BE_OPERATION_CONTRACT@lite
// proves: BE_OPERATION_CONTRACT@full
/** A generic request is usable only with the schemas and runtime pipe of the same table. */
import test from "node:test"
import { appDeclaration } from "../fixtures/app.ts"
import { BE_DECLARATION, TYPED_ROOT, at, ruleTester } from "../fixtures/typed/tester.ts"
import { hfsFromDeclaration } from "./lib/hfs.ts"
import { operationContractDecidable, operationRouteDrivenByTable, operationTableSchemas } from "./operations.ts"

const TABLE = at("apps/api/src/operations.ts")
const SPEC = at("src/modules/platform/operations/operations.policy.spec.ts")
const CONTROLLER = at("src/features/api/plan/transport/http/plan-operations.controller.ts")
const HEAD = `import { defineOperations, query, mutation, OperationValidationPolicy } from "@modules/platform/operations"
import { AnyParsedSchema, CoercedInputSchema, DateParsedSchema, DefaultedParsedSchema, EmptyInputSchema, FakeInputSchema, MaybeUndefinedParsedSchema, MaybeVoidParsedSchema, NestedOptionalSchema, NeverParsedSchema, OptionalParsedSchema, PlanInputSchema, PlanOutputSchema, UndefinedParsedSchema, UnknownParsedSchema, VoidParsedSchema } from "@modules/platform/operations/plan.schema"
`
const ENTRY = "query({ input: PlanInputSchema, output: PlanOutputSchema })"
const ROUTE = `${HEAD}import { Body, Controller, Post, ValidationPipe } from "@nestjs/common"
import type { OperationRequest, OperationReply } from "@modules/platform/operations"
const OPERATIONS = defineOperations({ "plan.read@1": ${ENTRY} })
const OTHER = defineOperations({ "plan.other@1": ${ENTRY} })
type Table = typeof OPERATIONS
`
const route = (body: string) => `@Controller("operations") class C { @Post() async invoke(${body} request: OperationRequest<Table>): Promise<OperationReply<Table>> { return null as never } }`

for (const edition of ["lite", "full"]) {
    const tester = ruleTester({ root: TYPED_ROOT, hfs: hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition }, TYPED_ROOT) })

    test(`R95 ${edition}: operation tables require input and output schema declarations in their owners`, () => {
        tester.run("operation-table-schemas", operationTableSchemas, {
            valid: [
                { filename: TABLE, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": ${ENTRY}, "plan.close@1": mutation({ input: PlanInputSchema, output: PlanOutputSchema, refusal: ["DENIED"] as const }) })` },
                { filename: TABLE, code: `${HEAD}const input = PlanInputSchema; const output = PlanOutputSchema; const options = { input, output }; const read = query(options); const entries = { "plan.read@1": read }; export const OPERATIONS = defineOperations(entries)` },
                { filename: TABLE, code: `${HEAD}import type { OperationContract } from "@modules/platform/operations"; const entries: { readonly "plan.read@1": OperationContract<{ readonly id: string }, { readonly ok: boolean }, never> } = { "plan.read@1": ${ENTRY} }; export const OPERATIONS = defineOperations(entries)` },
                { filename: TABLE, code: `${HEAD}import * as schemas from "@modules/platform/operations/plan.schema"; const entries = { "plan.read@1": query({ input: schemas.PlanInputSchema, output: schemas.PlanOutputSchema }) }; export const OPERATIONS = defineOperations({ ...entries })` },
                { filename: TABLE, code: `${HEAD}import { defineOperations as register, query as read } from "@modules/platform/operations"; export const OPERATIONS = register({ "plan.read@1": read({ input: PlanInputSchema, output: PlanOutputSchema }) })` },
                { filename: TABLE, code: `${HEAD}import { PlanInputSchema as Input, PlanOutputSchema as Output } from "@modules/platform/operations"; export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: Input, output: Output }) })` },
                // A spec keeps a stub table to itself and serves no operation, so R95 does not judge it.
                { filename: SPEC, code: `${HEAD}const STUB = defineOperations({ "plan.read@1": query({ input: FakeInputSchema, output: PlanOutputSchema }) })` },
                // Contract type declarations are also checked separately for decidability.
                { filename: TABLE, code: `${HEAD}const contract = query<{ readonly id: string }, { readonly ok: boolean }>()` },
            ],
            invalid: [
                { filename: TABLE, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query<{ readonly id: string }, { readonly ok: boolean }>() })`, errors: [{ messageId: "schemas", data: { operation: "plan.read@1" } }] },
                { filename: TABLE, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: PlanInputSchema }) })`, errors: [{ messageId: "schemas" }] },
                { filename: TABLE, code: `${HEAD}const fake = { safeParse(value: unknown) { return { success: true } } }; export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: fake, output: PlanOutputSchema }) })`, errors: [{ messageId: "schemas" }] },
                { filename: TABLE, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: { safeParse(value: unknown) { return { success: true } } }, output: PlanOutputSchema }) })`, errors: [{ messageId: "schemas" }] },
                { filename: TABLE, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: FakeInputSchema, output: PlanOutputSchema }) })`, errors: [{ messageId: "schemas" }] },
                { filename: at("src/features/api/plan/plan.schema.ts"), code: `${HEAD}declare const Input: typeof PlanInputSchema; export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: Input, output: PlanOutputSchema }) })`, errors: [{ messageId: "schemas" }] },
                { filename: at("src/modules/platform/operations/private.schema.ts"), code: `${HEAD}declare const Input: typeof PlanInputSchema; export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: Input, output: PlanOutputSchema }) })`, errors: [{ messageId: "schemas" }] },
                // a table a spec exports can be imported by production code, so it is judged like any table
                { filename: SPEC, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: FakeInputSchema, output: PlanOutputSchema }) })`, errors: [{ messageId: "schemas" }] },
                { filename: SPEC, code: `${HEAD}const STUB = defineOperations({ "plan.read@1": query({ input: FakeInputSchema, output: PlanOutputSchema }) }); export { STUB }`, errors: [{ messageId: "schemas" }] },
                { filename: SPEC, code: `${HEAD}const STUB = defineOperations({ "plan.read@1": query({ input: FakeInputSchema, output: PlanOutputSchema }) }); export default STUB`, errors: [{ messageId: "schemas" }] },
                { filename: SPEC, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: FakeInputSchema, output: PlanOutputSchema }) }) as const`, errors: [{ messageId: "schemas" }] },
                // the same stub table in a production file of the capability is judged
                { filename: at("src/modules/platform/operations/operations.contracts.ts"), code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: FakeInputSchema, output: PlanOutputSchema }) })`, errors: [{ messageId: "schemas" }] },
                { filename: TABLE, code: `${HEAD}export const OPERATIONS = defineOperations({})`, errors: [{ messageId: "table" }] },
                { filename: TABLE, code: `${HEAD}export const OPERATIONS = defineOperations()`, errors: [{ messageId: "table" }] },
            ],
        })
    })

    test(`R95 ${edition}: schema-based operation types remain closed`, () => {
        tester.run("operation-contract-decidable", operationContractDecidable, {
            valid: [
                { filename: TABLE, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": ${ENTRY} })` },
                { filename: TABLE, code: `${HEAD}export const OPERATIONS = defineOperations({ "health.read@1": query({ input: EmptyInputSchema, output: PlanOutputSchema }) })` },
                { filename: TABLE, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: CoercedInputSchema, output: PlanOutputSchema }) })` },
                { filename: TABLE, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: PlanInputSchema, output: PlanOutputSchema, refusal: ["DENIED", "INVALID"] }) })` },
                // a spec stub with an undecidable type serves no operation
                { filename: SPEC, code: `${HEAD}const contract = query<{}, { readonly ok: boolean }>()` },
            ],
            invalid: [
                { filename: TABLE, code: `${HEAD}const contract = query<{}, { readonly ok: boolean }>()`, errors: [{ messageId: "type", data: { label: "input", why: "an object type with no members" } }] },
                { filename: TABLE, code: `${HEAD}const contract = query<Record<string, never>, { readonly ok: boolean }>()`, errors: [{ messageId: "type", data: { label: "input", why: "a record of never" } }] },
                { filename: SPEC, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: UnknownParsedSchema, output: PlanOutputSchema }) })`, errors: [{ messageId: "type", data: { label: "input", why: "unknown" } }] },
                { filename: at("src/modules/platform/operations/operations.contracts.ts"), code: `${HEAD}const contract = query<{}, { readonly ok: boolean }>()`, errors: [{ messageId: "type", data: { label: "input", why: "an object type with no members" } }] },
                { filename: TABLE, code: `${HEAD}const codes: string[] = ["DENIED"]; export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: PlanInputSchema, output: PlanOutputSchema, refusal: codes }) })`, errors: [{ messageId: "refusal", data: { found: "string" } }] },
            ],
        })
    })

    test(`R95 ${edition}: request validation uses the canon pipe and the exact operation table`, () => {
        tester.run("operation-route-driven-by-table", operationRouteDrivenByTable, {
            valid: [
                { filename: CONTROLLER, code: `${ROUTE}${route("@Body(new OperationValidationPolicy(OPERATIONS))")}` },
                { filename: CONTROLLER, code: `${ROUTE}import { OperationValidationPolicy as Validate } from "@modules/platform/operations"; const alias = OPERATIONS; const pipe = new Validate(alias); ${route("@Body(pipe)")}` },
                { filename: CONTROLLER, code: `${ROUTE.replace("type Table = typeof OPERATIONS", "const typed: Readonly<typeof OPERATIONS> = OPERATIONS; type Table = typeof typed")}${route("@Body(new OperationValidationPolicy(typed))")}` },
            ],
            invalid: [
                { filename: CONTROLLER, code: `${ROUTE}${route("@Body()")}`, errors: [{ messageId: "validation" }] },
                { filename: CONTROLLER, code: `${ROUTE}${route("@Body(new ValidationPipe())")}`, errors: [{ messageId: "validation" }] },
                { filename: CONTROLLER, code: `${ROUTE}${route("@Body(new OperationValidationPolicy(OTHER))")}`, errors: [{ messageId: "validation" }] },
                { filename: CONTROLLER, code: `${ROUTE}${route("@Body('input', new OperationValidationPolicy(OPERATIONS))")}`, errors: [{ messageId: "validation" }] },
                { filename: CONTROLLER, code: `${ROUTE}${route("@Body(new OperationValidationPolicy({} as Table))")}`, errors: [{ messageId: "validation" }] },
                { filename: CONTROLLER, code: `${ROUTE}declare const selected: Table; ${route("@Body(new OperationValidationPolicy(selected))")}`, errors: [{ messageId: "validation" }] },
                { filename: CONTROLLER, code: `${ROUTE.replace(", OperationValidationPolicy", "")}class OperationValidationPolicy { constructor(_table: unknown) {} } ${route("@Body(new OperationValidationPolicy(OPERATIONS))")}`, errors: [{ messageId: "validation" }] },
            ],
        })
    })

    test(`R95 ${edition}: accepts owner generic plumbing and rejects undecidable parsed schema types inside and outside the owner`, () => {
        const owner = at("src/modules/platform/operations/registered.contracts.ts")
        tester.run("operation-contract-decidable", operationContractDecidable, {
            valid: [
                { filename: owner, code: `${HEAD}export const OPERATIONS = defineOperations({ "health.read@1": query({ input: EmptyInputSchema, output: PlanOutputSchema }) })` },
                { filename: owner, code: `${HEAD}import type { OperationContract, OperationTable } from "@modules/platform/operations"; export type Bounds = Readonly<Record<string, OperationContract<unknown, unknown, string>>>; export const register = <Table extends OperationTable>(table: Table): Table => table` },
                { filename: owner, code: `${HEAD}const forward = <Input extends typeof PlanInputSchema, Output extends typeof PlanOutputSchema>(schemas: { readonly input: Input; readonly output: Output }) => query(schemas)` },
                { filename: owner, code: `${HEAD}import type { OperationContract } from "@modules/platform/operations"; const entry: OperationContract<{}, { readonly ok: boolean }, never> = query({ input: EmptyInputSchema, output: PlanOutputSchema }); export const OPERATIONS = defineOperations({ "health.read@1": entry })` },
            ],
            invalid: [
                ...[owner, TABLE].flatMap((filename) => [
                    { filename, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: UnknownParsedSchema, output: PlanOutputSchema }) })`, errors: [{ messageId: "type", data: { label: "input", why: "unknown" } }] },
                    { filename, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: AnyParsedSchema, output: PlanOutputSchema }) })`, errors: [{ messageId: "type", data: { label: "input", why: "any" } }] },
                    { filename, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: DateParsedSchema, output: PlanOutputSchema }) })`, errors: [{ messageId: "type", data: { label: "input", why: "Date, which is not a JSON value" } }] },
                    { filename, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": mutation({ input: PlanInputSchema, output: UnknownParsedSchema }) })`, errors: [{ messageId: "type", data: { label: "output", why: "unknown" } }] },
                    { filename, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: NeverParsedSchema, output: PlanOutputSchema }) })`, errors: [{ messageId: "type", data: { label: "input", why: "never" } }] },
                ]),
                { filename: owner, code: `${HEAD}import type { OperationContract } from "@modules/platform/operations"; const entry: OperationContract<unknown, { readonly ok: boolean }, never> = query({ input: PlanInputSchema, output: PlanOutputSchema }); export const OPERATIONS = defineOperations({ "plan.read@1": entry })`, errors: [{ messageId: "type", data: { label: "input", why: "unknown" } }] },
                { filename: owner, code: `${HEAD}import type { OperationContract } from "@modules/platform/operations"; const entries: { readonly "plan.read@1": OperationContract<unknown, { readonly ok: boolean }, never> } = { "plan.read@1": query({ input: PlanInputSchema, output: PlanOutputSchema }) }; export const OPERATIONS = defineOperations(entries)`, errors: [{ messageId: "type", data: { label: "input", why: "unknown" } }] },
            ],
        })
    })

    test(`R95 ${edition}: accepts optional fields and parsed defaults but rejects absent root input and output values`, () => {
        const owner = at("src/modules/platform/operations/registered.contracts.ts")
        const absent = (label: string) => ({ messageId: "type", data: { label, why: "undefined or void at the root" } })
        tester.run("operation-contract-decidable", operationContractDecidable, {
            valid: [
                ...[owner, TABLE].flatMap((filename) => [
                    { filename, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: NestedOptionalSchema, output: NestedOptionalSchema }) })` },
                    { filename, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: DefaultedParsedSchema, output: DefaultedParsedSchema }) })` },
                ]),
                { filename: owner, code: `${HEAD}const forward = <Input extends typeof DefaultedParsedSchema, Output extends typeof NestedOptionalSchema>(schemas: { readonly input: Input; readonly output: Output }) => query(schemas)` },
            ],
            invalid: [
                ...[owner, TABLE].flatMap((filename) => [
                    { filename, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: OptionalParsedSchema, output: PlanOutputSchema }) })`, errors: [absent("input")] },
                    { filename, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: UndefinedParsedSchema, output: PlanOutputSchema }) })`, errors: [absent("input")] },
                    { filename, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: VoidParsedSchema, output: PlanOutputSchema }) })`, errors: [absent("input")] },
                    { filename, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: PlanInputSchema, output: MaybeUndefinedParsedSchema }) })`, errors: [absent("output")] },
                    { filename, code: `${HEAD}export const OPERATIONS = defineOperations({ "plan.read@1": query({ input: PlanInputSchema, output: MaybeVoidParsedSchema }) })`, errors: [absent("output")] },
                ]),
                { filename: TABLE, code: `${HEAD}const contract = query<string | undefined, { readonly ok: boolean }>()`, errors: [absent("input")] },
                { filename: owner, code: `${HEAD}import type { OperationContract } from "@modules/platform/operations"; const entry: OperationContract<string | undefined, { readonly ok: boolean }, never> = query({ input: DefaultedParsedSchema, output: PlanOutputSchema }); export const OPERATIONS = defineOperations({ "plan.read@1": entry })`, errors: [absent("input")] },
            ],
        })
    })
}
