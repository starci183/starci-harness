import fs from "node:fs"
import path from "node:path"
import { ScaffoldError } from "./service.mjs"
import { byCodeUnit } from "../report/order.mjs"

/** One barrel export a generator registers: the names exported from `source` in `file`, placed before `beforeSource` when present. */
interface Registration {
  readonly file: string;
  readonly source: string;
  readonly names: readonly string[];
  readonly type?: boolean;
  readonly beforeSource?: string;
}

const REGISTRATIONS: Readonly<Record<string, readonly Registration[]>> = Object.freeze({
  // The entity base a generated table entity extends (BE-PERSISTENCE-3), in either edition; AbstractEntity stays file-local until an
  // app's own composite-key entity imports it.
  "entity-base": [
    {
      file: "be/src/modules/platform/database/index.ts",
      source: "./abstract.entity",
      names: ["UuidAbstractEntity"],
    },
  ],
  api: [
    {
      file: "be/src/modules/domain/identity/index.ts",
      source: "./identity.decorators",
      names: ["CurrentPrincipal"],
    },
    {
      file: "be/src/modules/platform/cqrs/index.ts",
      source: "./cqrs.contracts",
      names: ["ExecuteParams"],
      type: true,
    },
    {
      file: "be/src/modules/platform/cqrs/index.ts",
      source: "./cqrs.decorators",
      names: ["InjectCommandBus"],
    },
  ],
  table: [
    {
      file: "be/src/modules/platform/database/index.ts",
      source: "./database.sql",
      names: ["requireOwnedEntity"],
      beforeSource: "./errors/database.error",
    },
    {
      file: "be/src/modules/platform/database/index.ts",
      source: "./primary.decorators",
      // PRIMARY_ENTITY_MANAGER: the token a generated table service's unit spec provides its EntityManager double under.
      names: ["InjectPrimaryEntityManager", "PRIMARY_ENTITY_MANAGER"],
    },
  ],
  // The queue and jobs capabilities state their outbox and claim statements with the sql tag and walk rows with the in-order relay
  // (the lite starter already carries the record guard the BullMQ client reads stored jobs with).
  queue: [
    {
      file: "be/src/modules/platform/primitives/index.ts",
      source: "./sequence.policy",
      names: ["eachInOrder"],
      beforeSource: "./record.policy",
    },
    {
      file: "be/src/modules/platform/database/index.ts",
      source: "./database.sql",
      names: ["sql"],
      beforeSource: "./errors/database.error",
    },
    {
      // The outbox write and the relay call the queue functions of their migration (R334).
      file: "be/src/modules/platform/database/index.ts",
      source: "./database.client",
      names: ["callDbFunction"],
      beforeSource: "./primary.decorators",
    },
  ],
  // The jobs capability (add job, the fenced-job pattern): its tick takes a transaction-scoped lock before it claims the minute (R335).
  jobs: [
    {
      file: "be/src/modules/platform/database/index.ts",
      source: "./database.client",
      names: ["advisoryXactLock", "callDbFunction"],
      beforeSource: "./primary.decorators",
    },
  ],
  webhook: [
    {
      file: "be/src/modules/platform/database/index.ts",
      source: "./database.sql",
      names: ["BATCH_ROWS", "sql"],
      beforeSource: "./errors/database.error",
    },
    {
      // The inbox claim and the lite event bus call the functions of their migration (R334).
      file: "be/src/modules/platform/database/index.ts",
      source: "./database.client",
      names: ["callDbFunction"],
      beforeSource: "./primary.decorators",
    },
    {
      // PRIMARY_ENTITY_MANAGER: the token the inbox service's unit spec provides its EntityManager double under.
      file: "be/src/modules/platform/database/index.ts",
      source: "./primary.decorators",
      names: ["InjectPrimaryEntityManager", "PRIMARY_ENTITY_MANAGER"],
    },
    {
      file: "be/src/modules/platform/http-security/index.ts",
      source: "./http-security.config",
      names: ["parseWebhookProviderConfig"],
    },
    {
      file: "be/src/modules/platform/http-security/index.ts",
      source: "./http-security.decorators",
      names: ["InjectWebhookSignature"],
    },
    {
      file: "be/src/modules/platform/http-security/index.ts",
      source: "./rate-limit.guard",
      names: ["RateLimit", "RateTier"],
    },
    {
      file: "be/src/modules/platform/http-security/index.ts",
      source: "./webhook-signature.service",
      names: ["WebhookSignatureService"],
    },
    {
      // The webhook door types its request with the correlation the logging middleware stamps on it.
      file: "be/src/modules/platform/logging/index.ts",
      source: "./correlation.contracts",
      names: ["CorrelationRequest"],
      type: true,
    },
    {
      // The lite event bus refuses an envelope whose correlation id is not one the logging capability issues.
      file: "be/src/modules/platform/logging/index.ts",
      source: "./correlation.policy",
      names: ["isCorrelationId"],
    },
  ],
  "webhook-full": [
    {
      file: "be/src/modules/platform/http-security/index.ts",
      source: "./http-security.config",
      names: ["parseWebhookProviderConfig"],
    },
    {
      file: "be/src/modules/platform/http-security/index.ts",
      source: "./http-security.decorators",
      names: ["InjectWebhookSignature"],
    },
    {
      file: "be/src/modules/platform/http-security/index.ts",
      source: "./rate-limit.guard",
      names: ["RateLimit", "RateTier"],
    },
    {
      file: "be/src/modules/platform/http-security/index.ts",
      source: "./webhook-signature.service",
      names: ["WebhookSignatureService"],
    },
  ],
  // The GraphQL server capability (be/src/modules/platform/graphql, written by the first GraphQL feature): the errors service and
  // the request locale it formats and localizes errors with.
  graphql: [
    {
      file: "be/src/modules/platform/errors/index.ts",
      source: "./errors.decorators",
      names: ["ERRORS_SERVICE"],
    },
    {
      file: "be/src/modules/platform/errors/index.ts",
      source: "./graphql-error.mapper",
      names: ["formatGraphqlError"],
    },
    {
      file: "be/src/modules/platform/errors/index.ts",
      source: "./errors.service",
      names: ["ErrorsService"],
      type: true,
    },
    {
      file: "be/src/modules/platform/i18n/index.ts",
      source: "./i18n.decorators",
      names: ["REQUEST_LOCALE"],
    },
  ],
  cli: [
    {
      file: "be/src/modules/platform/database/index.ts",
      source: "./migration-runner.service",
      names: ["MigrationRunnerService"],
      beforeSource: "./database.options",
    },
    {
      file: "be/src/modules/platform/database/index.ts",
      source: "./seed-runner.service",
      names: ["SeedRunnerService"],
      beforeSource: "./database.options",
    },
  ],
})

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Every file below a folder (absolute paths); none when the folder is absent. */
export const filesBelow = (folder: string): string[] => {
  const files: string[] = []
  const visit = (at: string): void => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const target = path.join(at, entry.name)
      if (entry.isDirectory()) visit(target)
      else files.push(target)
    }
  }
  if (fs.existsSync(folder)) visit(folder)
  return files
}

function addExport(text: string, registration: Registration): string {
  const kind = registration.type === true ? "export type" : "export"
  const line = new RegExp(`^${kind} \\{ ([^}]*) \\} from "${escape(registration.source)}"$`, "m")
  const found = line.exec(text)
  if (found) {
    const names = [...new Set([...found[1]!.split(",").map((name) => name.trim()), ...registration.names])].sort(byCodeUnit)
    return text.replace(line, `${kind} { ${names.join(", ")} } from "${registration.source}"`)
  }
  const added = `${kind} { ${registration.names.join(", ")} } from "${registration.source}"`
  if (registration.beforeSource) {
    const before = new RegExp(`^export(?: type)? \\{ [^}]* \\} from "${escape(registration.beforeSource)}"$`, "m")
    if (before.test(text)) return text.replace(before, `${added}\n$&`)
  }
  return `${text.replace(/\n+$/, "")}\n${added}\n`
}

/** The app-relative barrels one generator's registrations edit (a caller snapshots them before registerLiteExports). */
export const registrationFiles = (generator: string): string[] => [...new Set((REGISTRATIONS[generator] ?? []).map((registration) => registration.file))]

/** Adds only the barrel exports first consumed by one generator; full webhooks share the same optional platform API. */
export function registerLiteExports({ root, generator }: { root: string, generator: string }): string[] {
  const registrations = REGISTRATIONS[generator]
  if (!registrations) throw new ScaffoldError("HFS_ADD_EXPORTS_UNKNOWN", `no export registration exists for ${generator}`)
  const byFile = new Map<string, Registration[]>()
  for (const registration of registrations) {
    const list = byFile.get(registration.file) ?? []
    list.push(registration)
    byFile.set(registration.file, list)
  }
  const changed: string[] = []
  for (const [relative, entries] of byFile) {
    const file = path.join(root, ...relative.split("/"))
    if (!fs.existsSync(file)) {
      throw new ScaffoldError("HFS_ADD_EXPORTS_MISSING", `${generator} needs the scaffolded barrel ${relative}`)
    }
    const before = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")
    const after = entries.reduce(addExport, before)
    if (after !== before) {
      fs.writeFileSync(file, after)
      changed.push(relative)
    }
  }
  return changed
}

/** Makes a domain service public only when a generated transport first imports its module barrel. */
export function registerLiteDomainService({ root, moduleSpecifier, service }: { root: string, moduleSpecifier: string, service: string }): string | null {
  const prefix = "@modules/domain/"
  if (!moduleSpecifier.startsWith(prefix)) return null
  const owner = path.join(root, "be", "src", "modules", "domain", ...moduleSpecifier.slice(prefix.length).split("/"))
  const index = path.join(owner, "index.ts")
  if (!fs.existsSync(index)) {
    throw new ScaffoldError("HFS_ADD_EXPORTS_MISSING", `the generated transport needs the domain barrel ${moduleSpecifier}/index.ts`)
  }
  const candidates = filesBelow(owner).filter(
    (file) => file.endsWith(".service.ts") && new RegExp(`\\bexport\\s+class\\s+${escape(service)}\\b`).test(fs.readFileSync(file, "utf8")),
  )
  if (candidates.length !== 1) {
    throw new ScaffoldError("HFS_ADD_EXPORTS_SERVICE", `${moduleSpecifier} must contain exactly one exported ${service} in a .service.ts file`)
  }
  const before = fs.readFileSync(index, "utf8").replace(/\r\n/g, "\n")
  if (new RegExp(`\\b${escape(service)}\\b`).test(before)) return null
  const source = `./${path.relative(owner, candidates[0]!).replaceAll("\\", "/").replace(/\.ts$/, "")}`
  fs.writeFileSync(index, `${before.replace(/\n+$/, "")}\nexport { ${service} } from "${source}"\n`)
  return path.relative(root, index).replaceAll("\\", "/")
}
