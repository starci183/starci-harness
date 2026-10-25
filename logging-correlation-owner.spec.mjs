// proves: BE_INFRA_OWNER@lite
// proves: BE_INFRA_OWNER@full
/** Logger correlation owns async context exclusively, including from the test composition root. */
import test from "node:test"
import { RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { appDeclaration } from "./fixtures/app.mjs"
import { at, BE_DECLARATION, TYPED_ROOT } from "./fixtures/typed/tester.mjs"
import { hfsFromDeclaration } from "./lib/hfs.mjs"
import { infraImportOwner } from "./infra-owner.mjs"

const logging = at("src/modules/platform/logging/correlation.service.ts")
const domain = at("src/modules/domain/order/order.service.ts")
const asyncImports = [
    'import { AsyncLocalStorage } from "node:async_hooks"; export { AsyncLocalStorage }',
    'import { AsyncLocalStorage as Storage } from "async_hooks"; export { Storage }',
    'import * as hooks from "node:async_hooks"; export const store = new hooks.AsyncLocalStorage()',
    'export const load = () => import("async_hooks")',
    'export const load = () => import(`node:async_hooks`)',
    'const hooks = require("node:async_hooks"); export { hooks }',
    'import hooks = require("async_hooks"); export { hooks }',
    'export { AsyncLocalStorage as Storage } from "async_hooks"',
    'export * from "node:async_hooks"',
]

for (const edition of ["lite", "full"]) {
    test(`BE-LOGGING-4 ${edition}: async context belongs only to logging and CLS is refused everywhere`, () => {
        const hfs = hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition }, TYPED_ROOT)
        const tester = new RuleTester({
            languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
            settings: { starci: { hfs } },
        })
        tester.run("infra-import-owner", infraImportOwner, {
            valid: [
                ...asyncImports.map((code) => ({ filename: logging, code })),
                { filename: domain, code: "export const enqueue = (correlationId: string) => ({ correlationId })" },
                { filename: at("src/tests/world/kit/http.client.ts"), code: 'import { request } from "node:http"; export { request }' },
            ],
            invalid: [
                ...asyncImports.map((code) => ({ filename: domain, code, errors: [{ messageId: "foreign" }] })),
                ...[
                    "src/modules/platform/queue/queue.service.ts",
                    "src/modules/platform/http/http.client.ts",
                    "src/modules/platform/event-bus/event-bus.service.ts",
                    "src/modules/integrations/provider/provider.client.ts",
                    "src/features/api/order/application/place-order.handler.ts",
                    "src/tests/world/use-test-world.ts",
                    "src/tests/world/kit/context.ts",
                    "src/tests/integration/logging/correlation.integration-spec.ts",
                ].map((file) => ({ filename: at(file), code: asyncImports[0], errors: [{ messageId: "foreign" }] })),
                ...[logging, domain, at("src/tests/world/use-test-world.ts")].map((filename) => ({
                    filename,
                    code: 'import { ClsService } from "nestjs-cls"; export { ClsService }',
                    errors: [{ messageId: "nowhere" }],
                })),
                { filename: logging, code: 'export const load = () => import("nestjs-cls/dist")', errors: [{ messageId: "nowhere" }] },
            ],
        })
    })
}
