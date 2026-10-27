/**
 * The back-end plugin: every law's rules, gathered once.
 *
 * A consuming repository imports THIS and nothing below it. Registering rules one by one in the
 * target's own plugin file is how the two lists drift: a law gains a rule here, nobody adds it there,
 * and the rule ships as a document. That is not hypothetical for this axis - the back end kept a
 * hand-written plugin whose names had already diverged from canon's, so `no-nest-logger` and
 * `no-framework-logger` were one law wearing two names and no build could say which had fired.
 *
 * The target's `eslint.config.mjs` stays the authority on what is switched on, at what level and
 * over which globs. That is a different question from what EXISTS, and this file answers only the
 * second.
 *
 * WHAT THIS FILE REFUSES TO DO. It does not rename anything. A rule's published name is part of the
 * law that declares it, because that name is what appears in a build log, in a disable comment and in
 * every conversation about the failure. Aliasing one here to match a target's older spelling would
 * leave two names for one rule and no way to tell which a message came from.
 */
import { buildBeConfig } from "./lib/config.ts"
import { pluginForEdition } from "./lib/edition.ts"
import { recommended as ambientIdRecommended, rules as ambientIdRules } from "./ambient-id.ts"
import { recommended as appCompositionRecommended, rules as appCompositionRules } from "./app-composition.ts"
import { recommended as asyncDisciplineRecommended, rules as asyncDisciplineRules } from "./async-discipline.ts"
import { recommended as authorizationRecommended, rules as authorizationRules } from "./authorization.ts"
import { recommended as buildersRecommended, rules as buildersRules } from "./builders.ts"
import { recommended as commentsRecommended, rules as commentsRules } from "./comments.ts"
import { recommended as configOwnerRecommended, rules as configOwnerRules } from "./config-owner.ts"
import { recommended as connectionsRecommended, rules as connectionsRules } from "./connections.ts"
import { recommended as cookiesRecommended, rules as cookiesRules } from "./cookies.ts"
import { recommended as cqrsRecommended, rules as cqrsRules } from "./cqrs.ts"
import { recommended as dataAccessRecommended, rules as dataAccessRules } from "./data-access.ts"
import { recommended as defaultDenyRecommended, rules as defaultDenyRules } from "./default-deny.ts"
import { recommended as eventBusRecommended, rules as eventBusRules } from "./event-bus.ts"
import { recommended as jobsRecommended, rules as jobsRules } from "./jobs.ts"
import { recommended as projectionsRecommended, rules as projectionsRules } from "./projections.ts"
import { recommended as e2eFlowRecommended, rules as e2eFlowRules } from "./e2e-flow.ts"
import { recommended as errorHandlingRecommended, rules as errorHandlingRules } from "./error-handling.ts"
import { recommended as idempotencyRecommended, rules as idempotencyRules } from "./idempotency.ts"
import { recommended as infraOwnerRecommended, rules as infraOwnerRules } from "./infra-owner.ts"
import { recommended as injectionRecommended, rules as injectionRules } from "./injection.ts"
import { recommended as boundarySchemaRecommended, rules as boundarySchemaRules } from "./boundary-schema.ts"
import { recommended as inputBoundsRecommended, rules as inputBoundsRules } from "./input-bounds.ts"
import { recommended as logSafetyRecommended, rules as logSafetyRules } from "./log-safety.ts"
import { recommended as moduleLayeringRecommended, rules as moduleLayeringRules } from "./module-layering.ts"
import { recommended as moduleShapeRecommended, rules as moduleShapeRules } from "./module-shape.ts"
import { recommended as namingRecommended, rules as namingRules } from "./naming.ts"
import { recommended as observabilityRecommended, rules as observabilityRules } from "./observability.ts"
import { recommended as operationsRecommended, rules as operationsRules } from "./operations.ts"
import { recommended as querySafetyRecommended, rules as querySafetyRules } from "./query-safety.ts"
import { recommended as resilienceRecommended, rules as resilienceRules } from "./resilience.ts"
import { recommended as schemaAuthorityRecommended, rules as schemaAuthorityRules } from "./schema-authority.ts"
import { recommended as cliRecommended, rules as cliRules } from "./cli.ts"
import { recommended as serviceDepsRecommended, rules as serviceDepsRules } from "./service-deps.ts"
import { recommended as serviceIsolationRecommended, rules as serviceIsolationRules } from "./service-isolation.ts"
import { recommended as sizeBudgetRecommended, rules as sizeBudgetRules } from "./size-budget.ts"
import { recommended as specNoSkipRecommended, rules as specNoSkipRules } from "./spec-no-skip.ts"
import { recommended as specQualityRecommended, rules as specQualityRules } from "./spec-quality.ts"
import { recommended as suppressionRecommended, rules as suppressionRules } from "./suppression.ts"
import { recommended as temporalRecommended, rules as temporalRules } from "./temporal.ts"
import { recommended as testingRecommended, rules as testingRules } from "./testing.ts"
import { recommended as testWorldRecommended, rules as testWorldRules } from "./test-world.ts"
import { recommended as transportRecommended, rules as transportRules } from "./transport.ts"
import { recommended as typeSafetyRecommended, rules as typeSafetyRules } from "./type-safety.ts"
import { recommended as unitSpecRecommended, rules as unitSpecRules } from "./unit-spec.ts"
import { recommended as uploadsRecommended, rules as uploadsRules } from "./uploads.ts"
import { recommended as userCopyRecommended, rules as userCopyRules } from "./user-copy.ts"
import { recommended as webhooksRecommended, rules as webhooksRules } from "./webhooks.ts"
import { recommended as realtimeRecommended, rules as realtimeRules } from "./realtime.ts"
import { recommended as featureThinRecommended, rules as featureThinRules } from "./feature-thin.ts"
import { recommended as projectGraphRecommended, rules as projectGraphRules } from "./project-graph.ts"
import { recommended as sonarParityRecommended, rules as sonarParityRules } from "./sonar-parity.ts"

/** Each law's contribution, kept separate so a duplicate name is detectable rather than silent. */
const CONTRIBUTIONS = [
    { law: "project-graph", rules: projectGraphRules, recommended: projectGraphRecommended },
    { law: "ambient-id", rules: ambientIdRules, recommended: ambientIdRecommended },
    { law: "app-composition", rules: appCompositionRules, recommended: appCompositionRecommended },
    { law: "async-discipline", rules: asyncDisciplineRules, recommended: asyncDisciplineRecommended },
    { law: "authorization", rules: authorizationRules, recommended: authorizationRecommended },
    { law: "builders", rules: buildersRules, recommended: buildersRecommended },
    { law: "cli", rules: cliRules, recommended: cliRecommended },
    { law: "comments", rules: commentsRules, recommended: commentsRecommended },
    { law: "config-owner", rules: configOwnerRules, recommended: configOwnerRecommended },
    { law: "connections", rules: connectionsRules, recommended: connectionsRecommended },
    { law: "cookies", rules: cookiesRules, recommended: cookiesRecommended },
    { law: "cqrs", rules: cqrsRules, recommended: cqrsRecommended },
    { law: "data-access", rules: dataAccessRules, recommended: dataAccessRecommended },
    { law: "default-deny", rules: defaultDenyRules, recommended: defaultDenyRecommended },
    { law: "event-bus", rules: eventBusRules, recommended: eventBusRecommended },
    { law: "jobs", rules: jobsRules, recommended: jobsRecommended },
    { law: "projections", rules: projectionsRules, recommended: projectionsRecommended },
    { law: "e2e-flow", rules: e2eFlowRules, recommended: e2eFlowRecommended },
    { law: "error-handling", rules: errorHandlingRules, recommended: errorHandlingRecommended },
    { law: "idempotency", rules: idempotencyRules, recommended: idempotencyRecommended },
    { law: "infra-owner", rules: infraOwnerRules, recommended: infraOwnerRecommended },
    { law: "injection", rules: injectionRules, recommended: injectionRecommended },
    { law: "boundary-schema", rules: boundarySchemaRules, recommended: boundarySchemaRecommended },
    { law: "input-bounds", rules: inputBoundsRules, recommended: inputBoundsRecommended },
    { law: "log-safety", rules: logSafetyRules, recommended: logSafetyRecommended },
    { law: "module-layering", rules: moduleLayeringRules, recommended: moduleLayeringRecommended },
    { law: "module-shape", rules: moduleShapeRules, recommended: moduleShapeRecommended },
    { law: "naming", rules: namingRules, recommended: namingRecommended },
    { law: "observability", rules: observabilityRules, recommended: observabilityRecommended },
    { law: "operations", rules: operationsRules, recommended: operationsRecommended },
    { law: "query-safety", rules: querySafetyRules, recommended: querySafetyRecommended },
    { law: "resilience", rules: resilienceRules, recommended: resilienceRecommended },
    { law: "schema-authority", rules: schemaAuthorityRules, recommended: schemaAuthorityRecommended },
    { law: "service-deps", rules: serviceDepsRules, recommended: serviceDepsRecommended },
    { law: "service-isolation", rules: serviceIsolationRules, recommended: serviceIsolationRecommended },
    { law: "size-budget", rules: sizeBudgetRules, recommended: sizeBudgetRecommended },
    { law: "spec-no-skip", rules: specNoSkipRules, recommended: specNoSkipRecommended },
    { law: "spec-quality", rules: specQualityRules, recommended: specQualityRecommended },
    { law: "suppression", rules: suppressionRules, recommended: suppressionRecommended },
    { law: "temporal", rules: temporalRules, recommended: temporalRecommended },
    { law: "testing", rules: testingRules, recommended: testingRecommended },
    { law: "test-world", rules: testWorldRules, recommended: testWorldRecommended },
    { law: "transport", rules: transportRules, recommended: transportRecommended },
    { law: "type-safety", rules: typeSafetyRules, recommended: typeSafetyRecommended },
    { law: "unit-spec", rules: unitSpecRules, recommended: unitSpecRecommended },
    { law: "uploads", rules: uploadsRules, recommended: uploadsRecommended },
    { law: "user-copy", rules: userCopyRules, recommended: userCopyRecommended },
    { law: "webhooks", rules: webhooksRules, recommended: webhooksRecommended },
    { law: "realtime", rules: realtimeRules, recommended: realtimeRecommended },
    { law: "feature-thin", rules: featureThinRules, recommended: featureThinRecommended },
    { law: "sonar-parity", rules: sonarParityRules, recommended: sonarParityRecommended },
]

/** Every gathered law. */
export const lawOwners = CONTRIBUTIONS.map((entry) => entry.law)

/**
 * Every (law, rule name) pair as DECLARED, before any collapsing.
 *
 * This exists because `ruleOwners` and `rules` below are both built with `Object.fromEntries`, which
 * silently keeps the last writer when two laws declare one name. A test that walks either of them
 * therefore cannot see a collision: the duplicate is already gone by the time it looks, so every
 * name appears exactly once BY CONSTRUCTION and the check passes forever while being blind.
 *
 * That is exactly what happened - three back-end rules were declared by two laws each, one copy was
 * discarded on import, and the guard reported green the whole time. A gate that cannot fail is
 * indistinguishable from no gate, so the raw declarations are published here and the guard walks
 * these instead.
 */
export const ruleDeclarations = CONTRIBUTIONS.flatMap((entry) =>
  Object.keys(entry.rules).map((name) => ({ law: entry.law, name })),
)

/**
 * Which law declares each rule.
 *
 * Exported because a failing rule is a question about a LAW, and the shortest path from a build log
 * to the document that explains it is this map. It answers "who owns this name" for a name that
 * SHIPPED; proving no two laws claim one name is `ruleDeclarations`' job, not this map's.
 */
export const ruleOwners = Object.fromEntries(
    CONTRIBUTIONS.flatMap((entry) => Object.keys(entry.rules).map((name) => [name, entry.law])),
)

/** Every rule this canon publishes, keyed by its published name. */
export const rules = Object.fromEntries(
    CONTRIBUTIONS.flatMap((entry) => Object.entries(entry.rules)),
)

/**
 * The levels this canon asks for: every rule at `error`. There is no `warn` and no burn-down level; a rule with
 * debt is fixed in the repositories before it ships, never published weaker.
 */
export const recommended = Object.fromEntries(
    CONTRIBUTIONS.flatMap((entry) => Object.entries(entry.recommended)),
)

/** The plugin object, shaped the way a flat config expects it. */
const plugin = {
    meta: { name: "eslint-plugin-starci-be" },
    rules,
}

export default plugin

/**
 * The whole flat config of a back end: `export default starciBeConfig({ hfs: loadHfs(import.meta.url) })`.
 *
 * @param {{ hfs: object }} input - The HFS view of the repository.
 * @returns {Promise<Array<object>>} The flat config.
 */
export const starciBeConfig = ({ hfs }) => buildBeConfig({ hfs, plugin: pluginForEdition({ plugin, hfs }), recommended })

export { linterOptions } from "./lib/config.ts"
export { loadHfs } from "./lib/hfs.ts"

// A12 registration is appended so the shared registry can be union-merged.
import { recommended as thirdPartyOwnerRecommended, rules as thirdPartyOwnerRules } from "./third-party-owner.ts"
Object.assign(rules, thirdPartyOwnerRules)
Object.assign(recommended, thirdPartyOwnerRecommended)
lawOwners.push("third-party-owner")
for (const name of Object.keys(thirdPartyOwnerRules)) {
    ruleOwners[name] = "third-party-owner"
    // infra-owner also exposes these rules so the catalog's static contribution reader sees them.
    const declaration = ruleDeclarations.find((entry) => entry.name === name)
    if (declaration) declaration.law = "third-party-owner"
    else ruleDeclarations.push({ law: "third-party-owner", name })
}
// A21 append-only registration: keep the already exported plugin and recommendation live.
import { recommended as functionBudgetRecommended, rules as functionBudgetRules } from "./function-budget.ts"
CONTRIBUTIONS.push({ law: "function-budget", rules: functionBudgetRules, recommended: functionBudgetRecommended })
lawOwners.push("function-budget")
ruleDeclarations.push(...Object.keys(functionBudgetRules).map((name) => ({ law: "function-budget", name })))
Object.assign(ruleOwners, Object.fromEntries(Object.keys(functionBudgetRules).map((name) => [name, "function-budget"])))
Object.assign(rules, functionBudgetRules)
Object.assign(recommended, functionBudgetRecommended)
// A06 registrations are appended: the coordinator union-merges this shared registry.
import { recommended as edgeHardeningRecommended, rules as edgeHardeningRules } from "./edge-hardening.ts"
import { recommended as healthReadyRecommended, rules as healthReadyRules } from "./health-ready.ts"
import { recommended as jwtAlgRecommended, rules as jwtAlgRules } from "./jwt-alg.ts"

for (const entry of [
    { law: "edge-hardening", rules: edgeHardeningRules, recommended: edgeHardeningRecommended },
    { law: "health-ready", rules: healthReadyRules, recommended: healthReadyRecommended },
    { law: "jwt-alg", rules: jwtAlgRules, recommended: jwtAlgRecommended },
]) {
    lawOwners.push(entry.law)
    ruleDeclarations.push(...Object.keys(entry.rules).map((name) => ({ law: entry.law, name })))
    Object.assign(ruleOwners, Object.fromEntries(Object.keys(entry.rules).map((name) => [name, entry.law])))
    Object.assign(rules, entry.rules)
    Object.assign(recommended, entry.recommended)
}
