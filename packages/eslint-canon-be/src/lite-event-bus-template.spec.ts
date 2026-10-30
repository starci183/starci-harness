/**
 * The lite event bus templates of @starci/hfs (templates/be/inbox/platform/event-bus) against the lite persistence law (R334
 * `BE_PERSISTENCE_NO_RAW_SQL`): every database call of the pgmq bus goes through `callDbFunction` to a function the canon lists
 * (ruling lite-pgmq-bus-bullmq-jobs), and the retired outbox write is no longer listed.
 *
 *   node --test src/lite-event-bus-template.spec.ts
 */
import { readFileSync } from "node:fs"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { canonRuleTester } from "../fixtures/rule-tester.ts"
import { at, fixtureHfs } from "../fixtures/typed/tester.ts"
import { noRawSql } from "./no-raw-sql.ts"

const TEMPLATES = new URL("../../hfs/templates/be/inbox/platform/event-bus/", import.meta.url)
const template = (name: string): string => readFileSync(new URL(`${name}.ts.tpl`, TEMPLATES), "utf8")

const tester = canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: fixtureHfs() } },
})

test("no-raw-sql: the lite pgmq event bus templates call only listed database functions", () => {
    tester.run("no-raw-sql", noRawSql, {
        valid: ["event-bus.service", "event-consumer.service"].map((name) => ({
            filename: at(`src/modules/platform/event-bus/${name}.ts`),
            code: template(name),
        })),
        invalid: [
            {
                filename: at("src/modules/platform/event-bus/event-bus.service.ts"),
                code: "declare const callDbFunction: (manager: unknown, name: string, args: unknown[]) => Promise<unknown>; declare const tx: unknown\nexport const write = () => callDbFunction(tx, \"public.event_bus_write\", [])",
                errors: [{ messageId: "unlisted" }],
            },
        ],
    })
})
