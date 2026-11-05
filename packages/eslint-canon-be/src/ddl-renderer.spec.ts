/** The declared DDL renderer (hfs.json sides.be.ddlRenderers): DDL text only built and returned, never executed or reached from run-time code. */
// proves: BE_SCHEMA_AUTHORITY@lite
// proves: BE_SCHEMA_AUTHORITY@full
import test from "node:test"
import { at, fixtureHfs, ruleTester, TYPED_ROOT } from "../fixtures/typed/tester.ts"
import { packagesHfsFromDeclaration } from "./lib/hfs.ts"
import { appDeclaration } from "../fixtures/app.ts"
import { noRuntimeSchema } from "./schema-authority.ts"
import { BE_DECLARATION } from "../fixtures/typed/tester.ts"

const DECLARED = { ...BE_DECLARATION, ddlRenderers: [{ path: "packages/agent-sdk/src/entity/render*.ts", reason: "renders the DDL text that `cli entities plan --write` writes as new migration files" }] }
const packages = ruleTester({ root: TYPED_ROOT, hfs: packagesHfsFromDeclaration(appDeclaration("be", DECLARED), TYPED_ROOT) })
const side = ruleTester({ root: TYPED_ROOT, hfs: fixtureHfs(DECLARED) })
const undeclared = ruleTester({ root: TYPED_ROOT, hfs: packagesHfsFromDeclaration(appDeclaration("be", BE_DECLARATION), TYPED_ROOT) })

const RENDERER = at("packages/agent-sdk/src/entity/render.ts")
const RENDERER_SPLIT = at("packages/agent-sdk/src/entity/render-index.ts")
const OTHER_PACKAGE_FILE = at("packages/agent-sdk/src/entity/plan.ts")
const SERVICE = at("src/modules/domain/order/order.service.ts")
const CLI = at("src/features/cli/entities/plan.cli.ts")
const DDL = "export const render = (name: string): string => `CREATE TABLE ${name} (id uuid)`\nexport const drop = (): string => \"DROP INDEX plan_x\"\n"
const RENDERER_PATH = "../../../../packages/agent-sdk/src/entity/render-fixture"
const BARREL_PATH = "../../../../packages/agent-sdk/src"

test("a declared renderer may hold DDL text it only builds and returns", () => {
    packages.run("no-runtime-schema", noRuntimeSchema, {
        valid: [
            { filename: RENDERER, code: DDL },
            { filename: RENDERER_SPLIT, code: DDL },
        ],
        invalid: [
            // executing the text, or importing a client to execute it, is refused inside the renderer
            { filename: RENDERER, code: "declare const manager: { query(text: string): Promise<void> }\nexport const run = (ddl: string): Promise<void> => manager.query(ddl)\n", errors: [{ messageId: "rendererExecutes" }] },
            { filename: RENDERER, code: "declare const client: { execute(text: string): void }\nexport const run = (): void => client.execute(\"CREATE TABLE a (id int)\")\n", errors: [{ messageId: "rendererExecutes" }] },
            { filename: RENDERER, code: `import { DataSource } from "typeorm"\nexport const make = (): unknown => DataSource\n${DDL}`, errors: [{ messageId: "rendererClient" }] },
            // DDL text in any other file of the same package is still refused, and so is a renderer path that was not declared
            { filename: OTHER_PACKAGE_FILE, code: DDL, errors: [{ messageId: "ddl" }, { messageId: "ddl" }] },
        ],
    })
    undeclared.run("no-runtime-schema", noRuntimeSchema, {
        valid: [],
        invalid: [{ filename: RENDERER, code: DDL, errors: [{ messageId: "ddl" }, { messageId: "ddl" }] }],
    })
})

test("DDL text is refused in the be side even when a package path is declared, and the renderer cannot be reached from run-time code", () => {
    side.run("no-runtime-schema", noRuntimeSchema, {
        valid: [
            // the cli writes the files, so it imports the renderer; a barrel import of an unrelated name and a type-only import carry no DDL
            { filename: CLI, code: `import { renderCreateTable } from "${RENDERER_PATH}"\nexport const text = renderCreateTable("a")\n` },
            { filename: SERVICE, code: `import { defineEntity } from "${BARREL_PATH}"\nexport const name = defineEntity("a")\n` },
            { filename: SERVICE, code: `import type { renderCreateTable } from "${RENDERER_PATH}"\nexport type Render = typeof renderCreateTable\n` },
        ],
        invalid: [
            { filename: SERVICE, code: DDL, errors: [{ messageId: "ddl" }, { messageId: "ddl" }] },
            { filename: SERVICE, code: `import { renderCreateTable } from "${RENDERER_PATH}"\nexport const text = renderCreateTable("a")\n`, errors: [{ messageId: "rendererImported" }] },
            { filename: SERVICE, code: `import { renderCreateTable } from "${BARREL_PATH}"\nexport const text = renderCreateTable("a")\n`, errors: [{ messageId: "rendererImported" }] },
            { filename: SERVICE, code: `import * as sdk from "${BARREL_PATH}"\nexport const text = sdk.defineEntity("a")\n`, errors: [{ messageId: "rendererImported" }] },
            { filename: SERVICE, code: `export { renderCreateTable } from "${BARREL_PATH}"\n`, errors: [{ messageId: "rendererImported" }] },
        ],
    })
})
