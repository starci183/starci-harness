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

/** The correlation helpers the queue platform imports in either edition: the worker runs each job under the correlation id its envelope carries, which the outbox and the transport check. */
const QUEUE_CORRELATION: readonly Registration[] = [
  { file: "be/src/modules/platform/logging/index.ts", source: "./correlation.policy", names: ["isCorrelationId"] },
  { file: "be/src/modules/platform/logging/index.ts", source: "./correlation.port", names: ["CorrelationRunner"], type: true },
  { file: "be/src/modules/platform/logging/index.ts", source: "./logging.decorators", names: ["CORRELATION_RUNNER", "InjectCorrelationRunner"] },
]

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
    ...QUEUE_CORRELATION,
  ],
  // A full app's queue platform imports the same correlation helpers; its primitives and database barrels already export the rest.
  "queue-full": QUEUE_CORRELATION,
  // The jobs capability (add job, the fenced-job pattern): its tick takes a transaction-scoped lock before it claims the minute (R335).
  jobs: [
    {
      file: "be/src/modules/platform/database/index.ts",
      source: "./database.client",
      names: ["advisoryXactLock"],
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
      names: ["DEFAULT_SEED_ENV", "SeedRunnerService"],
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

/** The widest line the app's Prettier keeps on one line (`printWidth` of @starci/prettier-config, its owner). */
const PRINT_WIDTH = 120

/** One barrel export as the app's Prettier prints it: on one line when it fits, else one name a line with a trailing comma. */
function exportStatement(kind: string, names: readonly string[], source: string): string {
  const line = `${kind} { ${names.join(", ")} } from "${source}"`
  return line.length <= PRINT_WIDTH ? line : `${kind} {\n${names.map((name) => `    ${name},`).join("\n")}\n} from "${source}"`
}

/** The export statement of `source` in a barrel, on one line or broken over several as Prettier breaks it. */
const exportOf = (kind: string, source: string): RegExp => new RegExp(`^${kind} \\{\\s*([^}]*?)\\s*\\} from "${escape(source)}"$`, "m")

function addExport(text: string, registration: Registration): string {
  const kind = registration.type === true ? "export type" : "export"
  const line = exportOf(kind, registration.source)
  const found = line.exec(text)
  if (found) {
    const names = [...new Set([...found[1]!.split(",").map((name) => name.trim()).filter(Boolean), ...registration.names])].sort(byCodeUnit)
    return text.replace(line, exportStatement(kind, names, registration.source))
  }
  const added = exportStatement(kind, registration.names, registration.source)
  if (registration.beforeSource) {
    const before = exportOf("export(?: type)?", registration.beforeSource)
    if (before.test(text)) return text.replace(before, `${added}\n$&`)
  }
  return `${text.replace(/\n+$/, "")}\n${added}\n`
}

/** The app-relative barrels one generator's registrations edit (a caller snapshots them before registerLiteExports). */
export const registrationFiles = (generator: string): string[] => [...new Set((REGISTRATIONS[generator] ?? []).map((registration) => registration.file))]

/** One barrel a generator's registrations change: its app-relative path and its text before and after. */
export interface ExportEdit {
  readonly relative: string
  readonly before: string
  readonly after: string
}

/** The barrel edits one generator's registrations make, without writing them; a barrel the registrations leave as it is is not listed. */
export function liteExportEdits({ root, generator }: { root: string, generator: string }): ExportEdit[] {
  const registrations = REGISTRATIONS[generator]
  if (!registrations) throw new ScaffoldError("HFS_ADD_EXPORTS_UNKNOWN", `no export registration exists for ${generator}`)
  const byFile = new Map<string, Registration[]>()
  for (const registration of registrations) {
    const list = byFile.get(registration.file) ?? []
    list.push(registration)
    byFile.set(registration.file, list)
  }
  const edits: ExportEdit[] = []
  for (const [relative, entries] of byFile) {
    const file = path.join(root, ...relative.split("/"))
    if (!fs.existsSync(file)) {
      throw new ScaffoldError("HFS_ADD_EXPORTS_MISSING", `${generator} needs the scaffolded barrel ${relative}`)
    }
    const before = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")
    const after = entries.reduce(addExport, before)
    if (after !== before) edits.push({ relative, before, after })
  }
  return edits
}

/** Adds only the barrel exports first consumed by one generator; full webhooks share the same optional platform API. */
export function registerLiteExports({ root, generator }: { root: string, generator: string }): string[] {
  const edits = liteExportEdits({ root, generator })
  for (const edit of edits) fs.writeFileSync(path.join(root, ...edit.relative.split("/")), edit.after)
  return edits.map((edit) => edit.relative)
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
