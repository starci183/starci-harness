/**
 * The rule that holds BE-CONVENTION 1.10-1.14 (R90 `BE_INFRA_OWNER`).
 *
 * Every raw infrastructure library (HTTP, cache, queue, scheduler, logger, date, config, in-process events, model SDKs)
 * has exactly one owning platform or integration capability, and only files of that capability may import it or reach
 * for it as a global. The table lives in the slot manifest (`ruleParams.be.infraOwners`: specifier -> owners, `[]` for
 * "nowhere"), so the rule holds no library name of its own and the messages and the check read one source. A key covers
 * its subpaths, so a scope key (`@langchain`) covers every package of the scope, and the longest key wins
 * (`@langchain/langgraph` over `@langchain`).
 *
 * "Owning capability" is asked of the slot view (`ownerOf(filename)`), never of a path pattern. A reference is an
 * import (static, dynamic, `require`, `export ... from`) of the specifier or of a subpath of it, or a value reference to
 * an unresolved global (`fetch`, `setTimeout`, `globalThis.setInterval`) whose name is a key of the table. Specs are
 * included: they use the fake clock and the doubles the owning capability provides.
 *
 * The test world (slot `be.tests.world`, `src/tests/world`) is an infrastructure owner like the platform capabilities: it is
 * the TEST COMPOSITION ROOT that starts docker, polls readiness, serves the network-edge fakes over `node:http` and drives the
 * apps over HTTP with a raw client, and it has no Nest container to inject a port from. It may use libraries the
 * table gives an owner except logging infrastructure, whose ambient state stays inside its sole owner. A library the
 * table owns by nobody (`[]`, `nowhere`) is still refused there. A spec does not
 * compose: specs stay refused and reach infrastructure through `useTestWorld(...)`.
 *
 * `no-framework-logger` (R40) and `no-ambient-clock` (R79) judge Nest `Logger` and `Date`; the table holds neither.
 *
 * `http-client-only-in-integrations` holds the port half of the same law: the `HttpClient` port of `platform/http` (found
 * by the receiver's TYPE) is called only in an `integrations` owner, `platform/http` itself and the test world, so an
 * identity provider's token or admin endpoint, a mailer API or any other remote is spoken to by one integration only.
 */
import { hfsOf, inTestWorld } from "./lib/hfs.ts"
import { moduleReferences } from "./lib/import-source.ts"
import { isOwnedType } from "./lib/ports.ts"
import { recommended as thirdPartyRecommended, rules as thirdPartyRules } from "./third-party-owner.ts"
import type { Context, Node, Recommended, RuleModule, Rules } from "./lib/rule.ts"
import type { HfsView } from "./lib/hfs.ts"

/** The owner id of a file: the last two segments of its owner root (`platform/http`), or null when no owner holds it. */
const ownerIdOf = (hfs: HfsView, filename: string) => {
    const root = hfs.ownerOf(filename)
    return root === null ? null : root.split("/").slice(-2).join("/")
}

/** The table key a module specifier falls under (the specifier itself or a subpath of it, with or without `node:`), or null. */
const keyOf = (table: Readonly<Record<string, readonly string[]>>, specifier: string) => {
    const variants = [specifier, specifier.startsWith("node:") ? specifier.slice(5) : `node:${specifier}`]
    let best: string | null = null
    for (const variant of variants) {
        for (const key of Object.keys(table)) {
            if ((variant === key || variant.startsWith(`${key}/`)) && (best === null || key.length > best.length)) best = key
        }
    }
    return best
}

/** A raw infrastructure library is used only inside the capability that owns it. */
export const infraImportOwner: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "A raw infrastructure library (HTTP, cache, queue, scheduler, logger, date, config, events) is imported or referenced only by its owning capability." },
        schema: [],
        messages: {
            foreign: "`{{name}}` is owned by {{owners}}. Use that capability's port (injected with its `Inject*()` decorator) instead of the raw library, or move this code into the owner.",
            nowhere: "`{{name}}` is not used in a back end: its job belongs to another owner's port (config through the typed `<c>.config.ts`, events through `eventBus.publish(event, tx)` of `platform/event-bus`, schedules and background jobs through a queue's BullMQ job scheduler of `platform/queue`, a model call through the LangChain client of `integrations/ai` and the ai-router gateway, an agent loop in the agent runtime). Remove it.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const table = hfs.ruleParams.infraOwners
        const here = ownerIdOf(hfs, context.filename)
        const isWorld = inTestWorld(hfs, context.filename)
        const check = (node: Node, name: string, key: string) => {
            const owners = table[key]
            if (!owners) return
            if ((here !== null && owners.includes(here)) || (isWorld && owners.length > 0 && !owners.includes("platform/logging"))) return
            if (owners.length === 0) context.report({ node, messageId: "nowhere", data: { name } })
            else context.report({ node, messageId: "foreign", data: { name, owners: owners.map((owner) => `\`${owner}\``).join(", ") } })
        }
        return {
            ...moduleReferences(({ source, value }) => {
                const key = keyOf(table, value)
                if (key !== null) check(source, value, key)
            }),
            MemberExpression(node) {
                if (node.computed || node.object.type !== "Identifier" || node.object.name !== "globalThis" || node.property.type !== "Identifier") return
                if (Object.hasOwn(table, node.property.name)) check(node, `globalThis.${node.property.name}`, node.property.name)
            },
            "Program:exit"() {
                const globalScope = context.sourceCode.scopeManager?.globalScope
                if (!globalScope) return
                const references = [...globalScope.through, ...globalScope.variables.filter((variable) => variable.defs.length === 0).flatMap((variable) => variable.references)]
                for (const reference of references) {
                    if (reference.isValueReference === false) continue
                    const name = reference.identifier.name
                    if (Object.hasOwn(table, name)) check(reference.identifier, name, name)
                }
            },
        }
    },
}

/** The `HttpClient` port of `platform/http`: the one outbound HTTP door, judged by the receiver's TYPE. */
const isHttpClient = (context: Context, node: Node) => isOwnedType(context, node, { name: "HttpClient", capability: "http", tier: "platform" })

/**
 * A provider is spoken to only by its integration (BE-INFRA-3): a call on the `HttpClient` port is made only in an
 * `integrations` owner, in `platform/http` itself and in the test world. A domain service, a feature or another platform
 * capability that calls an identity provider's token or admin endpoint, a mailer API or any other remote over HTTP holds a
 * second copy of that provider's protocol, credentials and failure mapping; it calls the integration's public API instead.
 */
export const httpClientOnlyInIntegrations: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "The `HttpClient` port of `platform/http` is called only by an `integrations` owner (and `platform/http`, the test world)." },
        schema: [],
        messages: {
            foreign: "`{{call}}` calls the `HttpClient` port of `platform/http` outside an integration. A provider (identity provider, mailer, payment, another service) is spoken to only by its `integrations/<provider>` client; call that integration's public API here.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const file = context.filename
        if (hfs.tierOf(file) === "integrations" || ownerIdOf(hfs, file) === "platform/http" || inTestWorld(hfs, file)) return {}
        return {
            CallExpression(node) {
                const callee = node.callee
                if (callee.type !== "MemberExpression" || !isHttpClient(context, callee.object)) return
                context.report({ node, messageId: "foreign", data: { call: context.sourceCode.getText(callee) } })
            },
        }
    },
}

/** The rules this law contributes to the plugin. */
export const rules = {
    "infra-import-owner": infraImportOwner,
    "http-client-only-in-integrations": httpClientOnlyInIntegrations,
    ...thirdPartyRules,
} satisfies Rules

/** Every rule of this law at `error`. */
export const recommended: Recommended = {
    "starci-be/infra-import-owner": "error",
    "starci-be/http-client-only-in-integrations": "error",
    ...thirdPartyRecommended,
}
