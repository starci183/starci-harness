// The entity registry (persistence.md BE-PERSISTENCE-3, slot be.platform.database.entities, role entity-registry): the one platform
// file that imports a capability's `<c>Entities` from its index.ts, and the one file reached by deep path, only from app composition
// and the test world. Every other import of the same shapes stays refused, and full has no registry.
import test from "node:test"
import { appDeclaration } from "../fixtures/app.mjs"
import { at, BE_DECLARATION, ruleTester, TYPED_ROOT } from "../fixtures/typed/tester.mjs"
import { projectFixture } from "../fixtures/project/tester.mjs"
import { ruleNamed } from "../fixtures/rule-tester.mjs"
import { hfsFromDeclaration } from "./lib/hfs.ts"
import { importOwnerEntry } from "./module-layering.ts"
import { rules } from "./project-graph.ts"
import type { TestContext } from "node:test"
import type { ProjectFixture } from "../fixtures/project/tester.mjs"

const REGISTRY = "src/modules/platform/database/entities.ts"
const OWNER = "src/modules/domain/billing"
const COMPOSE = "apps/core/src/compose/platform.ts"
const APP_MODULE = "apps/core/src/app.module.ts"
const WORLD = "src/tests/world/lite-world.service.ts"
const DOMAIN_IMPORTER = `${OWNER}/billing.service.ts`
const FEATURE_IMPORTER = "src/features/api/invoices/index.ts"
const PLATFORM_IMPORTER = "src/modules/platform/audit/audit.service.ts"

const BASE_FILES = {
    "src/modules/platform/database/index.ts": "export { DatabaseModule } from './database.module';\n",
    "src/modules/platform/database/database.module.ts": "export class DatabaseModule {}\n",
    [`${OWNER}/index.ts`]: "export { billingEntities } from './persistence/entities/index';\nexport { BillingService } from './billing.service';\n",
    [`${OWNER}/persistence/entities/index.ts`]: "export const billingEntities = [];\n",
    [DOMAIN_IMPORTER]: "export class BillingService {}\n",
}

const AUDIT_INDEX = { "src/modules/platform/audit/index.ts": "export { AuditService } from './audit.service';\n" }

const fixture = (t: TestContext, edition: "lite" | "full", files: Readonly<Record<string, string>>) => {
    const made = projectFixture({ edition, files: { ...BASE_FILES, ...files } })
    t.after(made.cleanup)
    return made
}
const ok = (f: ProjectFixture, files: Readonly<Record<string, string>>, rel: string) => ({ filename: f.at(rel), code: files[rel] ?? "" })
const bad = (f: ProjectFixture, files: Readonly<Record<string, string>>, rel: string, code: RegExp) => ({ ...ok(f, files, rel), errors: [{ message: code, line: 1 }] })

test("BE_TIER_DIRECTION lite: the registry alone names a capability's <c>Entities from its index.ts", (t) => {
    const files = {
        [REGISTRY]: "import { billingEntities } from '../../domain/billing';\nexport const PRIMARY_ENTITIES = [...billingEntities];\n",
        "src/modules/platform/database/other.ts": "import { billingEntities } from '../../domain/billing';\nexport const others = billingEntities;\n",
        ...AUDIT_INDEX,
        [PLATFORM_IMPORTER]: "import { BillingService } from '../../domain/billing';\nexport class AuditService { constructor(readonly billing: BillingService) {} }\n",
    }
    const f = fixture(t, "lite", files)
    f.tester.run("tier-direction", ruleNamed(rules, "tier-direction"), {
        valid: [ok(f, files, REGISTRY)],
        invalid: [
            bad(f, files, "src/modules/platform/database/other.ts", /\[BE_TIER_DIRECTION\]/),
            bad(f, files, PLATFORM_IMPORTER, /\[BE_TIER_DIRECTION\]/),
        ],
    })
})

test("BE_TIER_DIRECTION lite: the registry importing anything but <c>Entities stays refused", (t) => {
    const cases = {
        other: "import { BillingService } from '../../domain/billing';\nexport const PRIMARY_ENTITIES = [BillingService];\n",
        mixed: "import { billingEntities, BillingService } from '../../domain/billing';\nexport const PRIMARY_ENTITIES = [...billingEntities, BillingService];\n",
        namespace: "import * as billing from '../../domain/billing';\nexport const PRIMARY_ENTITIES = [...billing.billingEntities];\n",
        reexport: "export { billingEntities } from '../../domain/billing';\nexport const PRIMARY_ENTITIES = [];\n",
        deep: "import { billingEntities } from '../../domain/billing/persistence/entities/index';\nexport const PRIMARY_ENTITIES = [...billingEntities];\n",
    }
    for (const [name, code] of Object.entries(cases)) {
        const files = { [REGISTRY]: code }
        const f = fixture(t, "lite", files)
        f.tester.run(`tier-direction (${name})`, ruleNamed(rules, "tier-direction"), {
            valid: [],
            invalid: [bad(f, files, REGISTRY, /\[BE_TIER_DIRECTION\]/)],
        })
    }
})

test("BE_TIER_DIRECTION full: there is no registry, so platform never imports a domain", (t) => {
    const files = { [REGISTRY]: "import { billingEntities } from '../../domain/billing';\nexport const PRIMARY_ENTITIES = [...billingEntities];\n" }
    const f = fixture(t, "full", files)
    f.tester.run("tier-direction", ruleNamed(rules, "tier-direction"), { valid: [], invalid: [bad(f, files, REGISTRY, /\[BE_TIER_DIRECTION\]/)] })
})

const IMPORT_REGISTRY = (from: string) => `import { PRIMARY_ENTITIES } from '${from}';\nexport const registered = PRIMARY_ENTITIES;\n`
const importerFiles = {
    ...AUDIT_INDEX,
    [REGISTRY]: "export const PRIMARY_ENTITIES = [];\n",
    [COMPOSE]: IMPORT_REGISTRY("../../../../src/modules/platform/database/entities"),
    [APP_MODULE]: IMPORT_REGISTRY("../../../src/modules/platform/database/entities"),
    [WORLD]: IMPORT_REGISTRY("../../modules/platform/database/entities"),
    [DOMAIN_IMPORTER]: IMPORT_REGISTRY("../../platform/database/entities"),
    [FEATURE_IMPORTER]: IMPORT_REGISTRY("../../../modules/platform/database/entities"),
    [PLATFORM_IMPORTER]: IMPORT_REGISTRY("../database/entities"),
}

test("ARCH_OWNER_EXPORT_BYPASS lite: app composition and the test world reach the registry by deep path, nothing else does", (t) => {
    const f = fixture(t, "lite", importerFiles)
    f.tester.run("owner-export-bypass", ruleNamed(rules, "owner-export-bypass"), {
        valid: [ok(f, importerFiles, COMPOSE), ok(f, importerFiles, APP_MODULE), ok(f, importerFiles, WORLD)],
        invalid: [
            bad(f, importerFiles, DOMAIN_IMPORTER, /\[ARCH_OWNER_EXPORT_BYPASS\]/),
            bad(f, importerFiles, FEATURE_IMPORTER, /\[ARCH_OWNER_EXPORT_BYPASS\]/),
            bad(f, importerFiles, PLATFORM_IMPORTER, /\[ARCH_OWNER_EXPORT_BYPASS\]/),
        ],
    })
})

test("ARCH_OWNER_EXPORT_BYPASS full: no file reaches platform/database/entities.ts by deep path", (t) => {
    const f = fixture(t, "full", importerFiles)
    f.tester.run("owner-export-bypass", ruleNamed(rules, "owner-export-bypass"), {
        valid: [],
        invalid: [bad(f, importerFiles, COMPOSE, /\[ARCH_OWNER_EXPORT_BYPASS\]/), bad(f, importerFiles, WORLD, /\[ARCH_OWNER_EXPORT_BYPASS\]/)],
    })
})

const DEEP = "import { PRIMARY_ENTITIES } from '@modules/platform/database/entities'"

test("import-owner-entry lite: the deep path @modules/platform/database/entities is admitted from app composition and the test world only", () => {
    const tester = ruleTester({ root: TYPED_ROOT, hfs: hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition: "lite" }, TYPED_ROOT) })
    tester.run("import-owner-entry", importOwnerEntry, {
        valid: [
            { filename: at("apps/api/src/compose/platform.ts"), code: DEEP },
            { filename: at("apps/cli/src/compose/modules.ts"), code: DEEP },
            { filename: at("apps/api/src/app.module.ts"), code: DEEP },
            { filename: at("src/tests/world/lite-world.service.ts"), code: DEEP },
        ],
        invalid: [
            { filename: at("src/modules/domain/plan/plan.service.ts"), code: DEEP, errors: [{ messageId: "deep" }] },
            { filename: at("src/features/api/checkout/application/place.handler.ts"), code: DEEP, errors: [{ messageId: "deep" }] },
            { filename: at("src/modules/platform/config/config.service.ts"), code: DEEP, errors: [{ messageId: "deep" }] },
            { filename: at("apps/api/src/main.ts"), code: DEEP, errors: [{ messageId: "deep" }] },
            { filename: at("apps/api/src/compose/platform.ts"), code: "import { DatabaseModule } from '@modules/platform/database/database.module'", errors: [{ messageId: "deep" }] },
        ],
    })
})

test("import-owner-entry full: the registry is no slot, so its deep path is refused everywhere", () => {
    const tester = ruleTester({ root: TYPED_ROOT, hfs: hfsFromDeclaration({ ...appDeclaration("be", BE_DECLARATION), edition: "full" }, TYPED_ROOT) })
    tester.run("import-owner-entry", importOwnerEntry, {
        valid: [],
        invalid: [
            { filename: at("apps/api/src/compose/platform.ts"), code: DEEP, errors: [{ messageId: "deep" }] },
            { filename: at("src/tests/world/lite-world.service.ts"), code: DEEP, errors: [{ messageId: "deep" }] },
        ],
    })
})

// The r-5 shape: agent-connections uses platform/database, shifts uses agent-connections, and the registry names both lists.
const CYCLE_FILES = {
    "src/modules/platform/database/index.ts": "export { DatabaseModule } from './database.module';\n",
    "src/modules/platform/database/database.module.ts": "export class DatabaseModule {}\n",
    "src/modules/domain/agent-connections/index.ts": "export { agentConnectionsEntities } from './persistence/entities/index';\nexport { AgentConnectionsService } from './agent-connections.service';\n",
    "src/modules/domain/agent-connections/persistence/entities/index.ts": "export const agentConnectionsEntities = [];\n",
    "src/modules/domain/agent-connections/agent-connections.service.ts": "import { DatabaseModule } from '../../platform/database';\nexport class AgentConnectionsService { readonly db = DatabaseModule }\n",
    "src/modules/domain/shifts/index.ts": "export { shiftsEntities } from './persistence/entities/index';\nexport { ShiftsService } from './shifts.service';\n",
    "src/modules/domain/shifts/persistence/entities/index.ts": "export const shiftsEntities = [];\n",
    "src/modules/domain/shifts/shifts.service.ts": "import { AgentConnectionsService } from '../agent-connections';\nexport class ShiftsService { constructor(readonly connections: AgentConnectionsService) {} }\n",
    [REGISTRY]: "import { agentConnectionsEntities } from '../../domain/agent-connections';\nimport { shiftsEntities } from '../../domain/shifts';\nexport const PRIMARY_ENTITIES = [...agentConnectionsEntities, ...shiftsEntities];\n",
}
const CONNECTIONS_SERVICE = "src/modules/domain/agent-connections/agent-connections.service.ts"

test("ARCH_OWNER_CYCLE lite: the registry is a unit of its own, so naming every <c>Entities closes no cycle", (t) => {
    const made = projectFixture({ edition: "lite", files: CYCLE_FILES })
    t.after(made.cleanup)
    made.tester.run("owner-cycle", ruleNamed(rules, "owner-cycle"), {
        valid: [ok(made, CYCLE_FILES, REGISTRY), ok(made, CYCLE_FILES, CONNECTIONS_SERVICE), ok(made, CYCLE_FILES, "src/modules/domain/shifts/shifts.service.ts")],
        invalid: [],
    })
})

test("ARCH_OWNER_CYCLE lite: a platform-to-domain edge from any other platform/database file still closes the cycle", (t) => {
    const files = { ...CYCLE_FILES, "src/modules/platform/database/lookup.ts": "import { ShiftsService } from '../../domain/shifts';\nexport const lookup = ShiftsService;\n" }
    const made = projectFixture({ edition: "lite", files })
    t.after(made.cleanup)
    made.tester.run("owner-cycle", ruleNamed(rules, "owner-cycle"), {
        valid: [ok(made, files, REGISTRY)],
        invalid: [bad(made, files, CONNECTIONS_SERVICE, /\[ARCH_OWNER_CYCLE\].*agent-connections -> src\/modules\/platform\/database -> src\/modules\/domain\/shifts/)],
    })
})
