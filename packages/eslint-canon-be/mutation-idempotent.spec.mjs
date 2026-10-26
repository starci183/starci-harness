/** Client retries preserve a required validated key and execute inside the domain transaction. */
// proves: BE_MUTATION_IDEMPOTENT@lite BE_MUTATION_IDEMPOTENT@full
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { BE_DECLARATION, TYPED_ROOT, at, ruleTester } from "./fixtures/typed/tester.mjs"
import { appDeclaration } from "./fixtures/app.mjs"
import { hfsFromDeclaration } from "./lib/hfs.mjs"
import { mutationIdempotent } from "./lib/client-idempotency.mjs"
import { rules, recommended } from "./idempotency.mjs"

const COMMAND = at("src/features/api/checkout/application/check-idempotency.command.ts")
const HANDLER = at("src/features/api/checkout/application/check-idempotency.handler.ts")
const SERVICE = at("src/modules/domain/order/client-effectful.service.ts")
const INPUT = at("src/features/api/checkout/transport/graphql/dto/client-effectful.input.ts")
const UNRELATED_INPUT = at("src/features/api/checkout/transport/graphql/dto/unrelated.input.ts")
const RESOLVER = at("src/features/api/checkout/transport/graphql/check-idempotency.resolver.ts")
const HEAD = 'import { Command, Query } from "@nestjs/cqrs"\nimport { Effectful } from "@modules/platform/inbox"\nimport type { ExecuteParams } from "@modules/platform/cqrs"\n'
const command = (request, { head = HEAD, mark = "@Effectful()", base = "Command" } = {}) => `${head}${mark}\nclass C extends ${base}<void> { constructor(readonly params: ExecuteParams<${request}>) { super() } }`
const SERVICE_HEAD = 'import "@features/api/checkout/application/client-effectful.handler"\nimport type { EntityManager } from "typeorm"\nimport type { Inbox } from "@modules/platform/inbox"\n'
const service = (body, { inbox = "Inbox", manager = "EntityManager", extra = "" } = {}) => `${SERVICE_HEAD}${extra}\nexport class ClientEffectfulService { constructor(private readonly manager: ${manager}, private readonly inbox: ${inbox}, private readonly other: EntityManager) {} async place(params: { personId: string; idempotencyKey: string }): Promise<void> { ${body} } private async work(): Promise<void> {} }`
const ENVELOPE = '{ principalId: params.personId, operation: "checkout.place", idempotencyKey: params.idempotencyKey, request: {} }'
const run = (envelope = ENVELOPE, manager = "tx", effect = "async () => this.work()") => `this.inbox.runClient(${envelope}, ${manager}, ${effect})`
const transaction = (execution = run()) => `return this.manager.transaction((tx) => ${execution})`
const HANDLER_HEAD = 'import { CommandHandler } from "@nestjs/cqrs"\nimport { ClientEffectfulCommand } from "@features/api/checkout/application/client-effectful.command"\nimport { ClientEffectfulService } from "@modules/domain/order/client-effectful.service"\n'
const handler = (body) => `${HANDLER_HEAD}@CommandHandler(ClientEffectfulCommand) class H { constructor(private readonly orders: ClientEffectfulService) {} process(command: ClientEffectfulCommand) { ${body} } }`
const VALIDATORS = 'import { IsString, IsUUID, MinLength, MaxLength, IsOptional, ValidateIf } from "class-validator"\n'
const DTO_REACHED = 'import "@features/api/checkout/transport/graphql/client-effectful.resolver"\n'
const input = (validation, type = "!: string") => `${DTO_REACHED}${VALIDATORS}export class ClientEffectfulInput { ${validation} idempotencyKey${type} }`
const resolution = (validation, key = "input.idempotencyKey") => `${VALIDATORS}import { ClientEffectfulCommand } from "@features/api/checkout/application/client-effectful.command"\nclass Input { ${validation} idempotencyKey!: string }\nfunction dispatch(input: Input) { return new ClientEffectfulCommand({ principal: { id: "person" }, request: { idempotencyKey: ${key} } }) }`
const mappedResolution = (mapper, argument = "input", validation = "@IsUUID()") => resolution(validation)
    .replace("function dispatch", `${mapper}\nfunction dispatch`)
    .replace("request: { idempotencyKey: input.idempotencyKey }", `request: toRequest(${argument})`)

test("mutation-idempotent is registered and enabled at error", () => {
    assert.equal(rules["mutation-idempotent"], mutationIdempotent)
    assert.equal(recommended["starci-be/mutation-idempotent"], "error")
    for (const message of Object.values(mutationIdempotent.meta.messages)) assert.match(message, /^\[BE_MUTATION_IDEMPOTENT\] /)
})

for (const edition of ["lite", "full"]) {
    test(`effectful commands and their actual domain transactions are enforced in ${edition}`, () => {
        // Each edition starts from the disk graph: the previous matrix replaces the imported service with invalid virtual sources.
        tsParser.clearCaches()
        const hfs = hfsFromDeclaration({ ...appDeclaration("be", { ...BE_DECLARATION, patterns: ["idempotency"] }), edition }, TYPED_ROOT)
        const tester = ruleTester({ root: TYPED_ROOT, hfs })
        assert.doesNotThrow(() => {
            tester.run("mutation-idempotent", mutationIdempotent, {
                valid: [
                    { filename: COMMAND, code: command("{ readonly idempotencyKey: string }") },
                    { filename: COMMAND, code: command("{ readonly idempotencyKey: string }", { head: HEAD.replace("{ Effectful }", "{ Effectful as RetrySafe }"), mark: "@RetrySafe()" }) },
                    { filename: COMMAND, code: command("{ readonly idempotencyKey: string }", { head: HEAD.replace('import { Effectful } from', 'import * as inbox from'), mark: "@inbox.Effectful()" }) },
                    { filename: COMMAND, code: command("{ readonly idempotencyKey: string }", { head: `${HEAD}const RetrySafe = Effectful\n`, mark: "@RetrySafe()" }) },
                    { filename: COMMAND, code: command("{ amount: number }", { mark: "" }) },
                    { filename: COMMAND, code: `${HEAD}@Effectful() class C extends Command<void> { constructor(readonly params: { idempotencyKey: string }) { super() } }` },
                    { filename: HANDLER, code: handler("return this.orders.place({ personId: command.params.principal.id, ...command.params.request })") },
                    { filename: HANDLER, code: handler("return this.orders.place({ personId: command.params.principal.id, idempotencyKey: command.params.request.idempotencyKey })") },
                    { filename: SERVICE, code: service(transaction()) },
                    { filename: SERVICE, code: service(`return this.manager.transaction(async (tx) => { return await ${run()} })`) },
                    { filename: SERVICE, code: service(`return this.manager.transaction("SERIALIZABLE", (tx) => ${run()})`) },
                    { filename: SERVICE, code: service(transaction().replaceAll("tx", "unit").replaceAll("this.inbox", "this.seen")).replace("readonly inbox", "readonly seen") },
                    { filename: INPUT, code: input("@IsUUID()") },
                    { filename: INPUT, code: input("@IsString() @MinLength(1) @MaxLength(64)") },
                    { filename: INPUT, code: input("@IsString() @MinLength(2) @MaxLength(32)") },
                    { filename: UNRELATED_INPUT, code: input("", "?: string").replace(DTO_REACHED, "") },
                    { filename: RESOLVER, code: resolution("@IsUUID()") },
                    { filename: RESOLVER, code: resolution("@IsString() @MinLength(1) @MaxLength(64)") },
                    { filename: RESOLVER, code: resolution("@IsUUID()").replace('request: { idempotencyKey: input.idempotencyKey }', 'request: input') },
                    { filename: RESOLVER, code: resolution("@IsUUID()", "input.operationKey").replace("idempotencyKey!: string", "idempotencyKey!: string; @IsUUID() operationKey!: string") },
                    { filename: RESOLVER, code: resolution("@IsUUID()").replace("class Input {", "class Base {").replace("function dispatch", "class Input extends Base {}\nfunction dispatch") },
                    { filename: RESOLVER, code: mappedResolution("const toRequest = (source: Input): {idempotencyKey: string} => ({idempotencyKey: source.idempotencyKey})") },
                    { filename: RESOLVER, code: mappedResolution("function toRequest(source: Input) { return {idempotencyKey: source.idempotencyKey} }") },
                    { filename: RESOLVER, code: mappedResolution('import { toClientEffectfulRequest as toRequest } from "@features/api/checkout/transport/graphql/client-effectful.mapper"') },
                    { filename: RESOLVER, code: `${VALIDATORS}import type { ExecuteParams } from "@modules/platform/cqrs"\nimport { ClientEffectfulCommand } from "@features/api/checkout/application/client-effectful.command"\nclass Input { @IsUUID() idempotencyKey!: string }\nfunction dispatch(params: ExecuteParams<Input>) { return new ClientEffectfulCommand(params) }` },
                    { filename: RESOLVER, code: `${VALIDATORS}import type { ExecuteParams } from "@modules/platform/cqrs"\nimport { ClientEffectfulCommand } from "@features/api/checkout/application/client-effectful.command"\nclass Input { @IsUUID() idempotencyKey!: string }\nfunction dispatch(params: ExecuteParams<Input>) { return new ClientEffectfulCommand({ ...params }) }` },
                ],
                invalid: [
                    ...["{ amount: number }", "{ idempotencyKey?: string }", "{ idempotencyKey: string | undefined }", "{ idempotencyKey: any }", "{ idempotencyKey: number }"].map((request) => ({ filename: COMMAND, code: command(request), errors: [{ messageId: "key" }] })),
                    { filename: COMMAND, code: command("{ idempotencyKey: string }", { base: "Query" }), errors: [{ messageId: "marker" }] },
                    { filename: COMMAND, code: command("{ idempotencyKey: string }", { head: HEAD.replace('import { Effectful } from "@modules/platform/inbox"', "const Effectful = (): ClassDecorator => () => {}") }), errors: [{ messageId: "marker" }] },
                    { filename: COMMAND, code: command("{ idempotencyKey: string }", { mark: "@Effectful" }), errors: [{ messageId: "marker" }] },
                    { filename: COMMAND, code: command("{ idempotencyKey: string }", { mark: "@Effectful(true)" }), errors: [{ messageId: "marker" }] },
                    { filename: COMMAND, code: command("{ idempotencyKey?: string }", { head: `${HEAD}const RetrySafe = Effectful\n`, mark: "@RetrySafe()" }), errors: [{ messageId: "key" }] },
                    { filename: COMMAND, code: command("{ idempotencyKey: string }", { head: `${HEAD}const Wrapped = (): ClassDecorator => Effectful()\n`, mark: "@Wrapped()" }), errors: [{ messageId: "marker" }] },
                    { filename: COMMAND, code: command("{ idempotencyKey: string }", { head: `${HEAD}declare const condition: boolean; const Wrapped = condition ? Effectful : (() => (() => {}))\n`, mark: "@Wrapped()" }), errors: [{ messageId: "marker" }] },
                    { filename: COMMAND, code: command("{ idempotencyKey: string }", { head: `${HEAD}const Wrapped = Effectful as typeof Effectful\n`, mark: "@Wrapped()" }), errors: [{ messageId: "marker" }] },
                    { filename: COMMAND, code: command("{ idempotencyKey: string }", { head: `${HEAD}const Wrapped = Effectful satisfies typeof Effectful\n`, mark: "@Wrapped()" }), errors: [{ messageId: "marker" }] },
                    { name: "hiding the marker and applying the lookalike are distinct violations", filename: COMMAND, code: command("{ idempotencyKey: string }", { head: `${HEAD}const annotations = { Effectful }\n`, mark: "@annotations.Effectful()" }), errors: [{ messageId: "marker", line: 4, column: 23 }, { messageId: "marker", line: 6, column: 7 }] },
                    { filename: HANDLER, code: handler('return this.orders.place({ personId: command.params.principal.id, idempotencyKey: "invented" })'), errors: [{ messageId: "handler" }] },
                    { filename: HANDLER, code: handler("this.orders.place({ personId: command.params.principal.id, ...command.params.request })"), errors: [{ messageId: "handler" }] },
                    { filename: HANDLER, code: handler('return this.orders.place({ personId: command.params.principal.id, ...command.params.request, idempotencyKey: "overwritten" })'), errors: [{ messageId: "handler" }] },
                    { filename: HANDLER, code: handler('return this.orders.place({ personId: command.params.principal.id, ...command.params.request, ["idempotencyKey"]: "overwritten" })'), errors: [{ messageId: "handler" }] },
                    { filename: HANDLER, code: handler('return this.orders.place({ personId: command.params.principal.id, ...command.params.request, ...({} as any) })'), errors: [{ messageId: "handler" }] },
                    { filename: HANDLER, code: handler('return this.orders.place({ personId: command.params.principal.id, ...command.params.request, [String(1)]: "overwritten" })'), errors: [{ messageId: "handler" }] },
                    ...[
                        "return this.work()",
                        `await this.work(); ${transaction()}`,
                        `await this.manager.transaction((tx) => ${run()}); return this.work()`,
                        `return this.manager.transaction((tx) => { ${run()}; return this.work() })`,
                        `return this.manager.transaction((tx) => { if (params.personId) return ${run()}; return this.work() })`,
                        `return this.manager.transaction((tx) => ${run(ENVELOPE, "this.manager")})`,
                        `return this.manager.transaction((tx) => ${run(ENVELOPE, "this.other")})`,
                        transaction(run(ENVELOPE.replace("params.idempotencyKey", '"constant"'))),
                        transaction(run(ENVELOPE.replace("request: {}", 'request: {}, ["idempotencyKey"]: "constant"'))),
                        transaction(run(ENVELOPE.replace("request: {}", 'request: {}, ...({} as any)'))),
                        transaction(run(ENVELOPE.replace("params.personId", '"everyone"'))),
                        transaction(run(ENVELOPE.replace('operation: "checkout.place"', 'operation: ""'))),
                        transaction(run(ENVELOPE.replace("request: {}", "request: this.work()"))),
                        transaction(run(ENVELOPE.replace("request: {}", "missing: {}"))),
                        transaction(run(ENVELOPE, "tx", "this.work()")),
                        `return this.manager.transaction((tx) => this.work(), (tx) => ${run()})`,
                        `return this.manager.transaction("UNKNOWN", (tx) => ${run()})`,
                        `const callback = (tx: EntityManager) => ${run()}; return this.manager.transaction(callback)`,
                        transaction().replace(".transaction(", ".transaction?.("),
                        transaction().replace(".runClient(", ".runClient?.("),
                        transaction().replace("this.inbox.runClient", "this.inbox?.runClient"),
                    ].map((body) => ({ filename: SERVICE, code: service(body), errors: [{ messageId: "transaction" }] })),
                    { filename: SERVICE, code: service(transaction(), { inbox: "PretendInbox", extra: 'interface PretendInbox { runClient<T>(request: object, tx: EntityManager, effect: () => Promise<T>): Promise<T> }' }), errors: [{ messageId: "transaction" }] },
                    { filename: SERVICE, code: service(transaction(), { manager: "PretendManager", extra: 'interface PretendManager { transaction<T>(effect: (tx: EntityManager) => Promise<T>): Promise<T> }' }), errors: [{ messageId: "transaction" }] },
                    ...["", "@IsUUID", "@MaxLength(64)", "@IsString() @MinLength(0) @MaxLength(64)", "@IsString() @MinLength(1) @MaxLength(65)", "@IsUUID() @IsOptional()", "@IsUUID() @ValidateIf(() => true)"].map((validation) => ({ filename: INPUT, code: input(validation), errors: [{ messageId: "validation" }] })),
                    { filename: INPUT, code: input("@IsUUID()", "?: string"), errors: [{ messageId: "validation" }] },
                    { filename: INPUT, code: `${DTO_REACHED}const IsUUID = (): PropertyDecorator => () => {}\nexport class ClientEffectfulInput { @IsUUID() idempotencyKey!: string }`, errors: [{ messageId: "validation" }] },
                    { filename: RESOLVER, code: resolution("@IsUUID()", '"generated"'), errors: [{ messageId: "validation" }] },
                    { filename: RESOLVER, code: resolution("@IsUUID()", "input.other").replace("idempotencyKey!: string", "idempotencyKey!: string; other!: string"), errors: [{ messageId: "validation" }] },
                    ...[
                        mappedResolution('const toRequest = (source: Input): {idempotencyKey: string} => ({idempotencyKey: "replacement"})'),
                        mappedResolution("const toRequest = (source: Input): {idempotencyKey: string} => ({idempotencyKey: source.idempotencyKey})", '{idempotencyKey: "generated"}'),
                        mappedResolution("const toRequest = (source: Input): {idempotencyKey: string} => ({idempotencyKey: source.idempotencyKey})", "input", ""),
                        mappedResolution("declare function toRequest(source: Input): {idempotencyKey: string}"),
                        mappedResolution("const toRequest = (source: Input) => { source.idempotencyKey = 'changed'; return {idempotencyKey: source.idempotencyKey} }"),
                        mappedResolution("declare function save(): void; const toRequest = (source: Input) => ({idempotencyKey: source.idempotencyKey, extra: save()})"),
                        mappedResolution("declare const captured: Input; const toRequest = (source: Input) => ({idempotencyKey: captured.idempotencyKey})"),
                    ].map((code) => ({ filename: RESOLVER, code, errors: [{ messageId: "validation" }] })),
                ],
            })
        })
    })
    test(`only marked client commands require the idempotency pattern in ${edition}`, () => {
        const hfs = hfsFromDeclaration({ ...appDeclaration("be", { ...BE_DECLARATION, patterns: ["queue"] }), edition }, TYPED_ROOT)
        assert.doesNotThrow(() => {
            ruleTester({ root: TYPED_ROOT, hfs }).run("mutation-idempotent", mutationIdempotent, {
                valid: [{ filename: COMMAND, code: command("{ amount: number }", { mark: "" }) }],
                invalid: [{ filename: COMMAND, code: command("{ idempotencyKey: string }"), errors: [{ messageId: "declaration" }] }],
            })
        })
    })
}
