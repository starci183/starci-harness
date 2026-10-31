import { nextMigrationStamp } from "./migration-stamp.mjs";
import fs from "node:fs";
import path from "node:path";
import { render, TEMPLATES_DIR } from "../sync/index.mjs";
import { ScaffoldError, pascalOf } from "./service.mjs";
import { filesBelow } from "./lite-exports.mjs";
import { jsonText } from "./app.mjs";
import { byCodeUnit } from "../report/order.mjs";
import { withSqlIdentifierError } from "./add-database-lite.mjs";

/** The values the inbox templates fill; the processing owner is named by `service` and `serviceModule`. */
export type InboxValues = Readonly<Record<string, string>>;

/** A file the generator will write: its app-relative path and its text. */
interface PlannedFile {
  relative: string;
  text: string;
}

/** A file the generator rewrites in place. */
interface Patch {
  readonly file: string;
  readonly text: string;
}

const MIGRATION = /^(\d{14})_[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.sql$/;
const PLACEHOLDER = /@@([A-Za-z][A-Za-z0-9]*)@@/g;

const upperOf = (name: string) => name.replaceAll("-", "_").toUpperCase();
const camelOf = (name: string) => {
  const pascal = pascalOf(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};
const snakeOf = (name: string) => name.replaceAll("-", "_");

const template = (relative: string, values: Readonly<Record<string, string | undefined>>): string => {
  const file = path.join(TEMPLATES_DIR, "be", "inbox", relative);
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  return text.replace(PLACEHOLDER, (whole: string, name: string) => {
    const value = values[name];
    if (value === undefined)
      throw new ScaffoldError(
        "HFS_ADD_PLACEHOLDER_UNKNOWN",
        `template be/inbox/${relative} uses ${whole}, which the lite webhook does not provide`,
      );
    return value;
  });
};

/** The lite templates of the webhook door and its unit spec: the door records the delivery in the provider inbox. */
const LITE_WEBHOOK_TEMPLATES: Readonly<Record<string, string>> = Object.freeze({
  "webhooks/webhook.door.ts.tpl": "../inbox/webhook-door.ts.tpl",
  "webhooks/webhook.door.spec.ts.tpl": "../inbox/webhook-door.spec.ts.tpl",
});

/** Lite replaces only the webhook door and its spec with the durable provider inbox intake. */
export const selectLiteWebhookEntries = <T extends { template?: string | undefined }>(entries: readonly T[]): T[] =>
  entries.map((entry) => {
    const lite = entry.template === undefined ? undefined : LITE_WEBHOOK_TEMPLATES[entry.template];
    return lite === undefined ? entry : { ...entry, template: lite };
  });

/** Validates the selected processing owner for a later reactor/job without invoking or changing that service in the door. */
function validateProcessingOwner({ root, service, serviceModule, provider }: { root: string, service: string, serviceModule: string, provider: string }): void {
  const prefix = "@modules/domain/";
  const capability = serviceModule.slice(prefix.length);
  if (!serviceModule.startsWith(prefix) || !/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/.test(capability))
    throw new ScaffoldError(
      "HFS_ADD_INBOX_SERVICE",
      `lite add webhook needs a processing service module below ${prefix}`,
    );
  const owner = path.join(root, "be", "src", "modules", "domain", ...capability.split("/"));
  const candidates = filesBelow(owner).filter((file) =>
    file.endsWith(".service.ts") && new RegExp(String.raw`\bexport\s+class\s+${service}\b`).test(fs.readFileSync(file, "utf8")),
  );
  if (candidates.length !== 1)
    throw new ScaffoldError(
      "HFS_ADD_INBOX_INTAKE",
      `${serviceModule} must export exactly one ${service} from a .service.ts file as the processing owner of the ${provider} inbox`,
    );
}

const databasePatches = (root: string): Patch[] => {
  const folder = path.join(root, "be", "src", "modules", "platform", "database");
  const indexFile = path.join(folder, "index.ts");
  const errorFile = path.join(folder, "errors", "database.error.ts");
  if (!fs.existsSync(indexFile) || !fs.existsSync(errorFile))
    throw new ScaffoldError(
      "HFS_ADD_INBOX_DATABASE",
      "lite add webhook needs the scaffolded platform/database capability",
    );
  let index = fs.readFileSync(indexFile, "utf8").replace(/\r\n/g, "\n");
  if (!index.split("\n").some((line) => line.startsWith("export { ") && line.includes("DatabaseErrorCode") && line.endsWith(' } from "./errors/database.error"')))
    index = `${index.trimEnd()}\nexport { DatabaseError, DatabaseErrorCode } from "./errors/database.error"\n`;
  let error = withSqlIdentifierError(fs.readFileSync(errorFile, "utf8").replace(/\r\n/g, "\n"));
  const enumLine =
    '    WebhookDeliveryIdRequired = "DATABASE_WEBHOOK_DELIVERY_ID_REQUIRED",';
  if (!error.includes(enumLine)) {
    const after =
      '    IdentifierRejected = "DATABASE_IDENTIFIER_REJECTED",';
    const mapping =
      '    [DatabaseErrorCode.IdentifierRejected]: "internal",';
    if (!error.includes(after) || !error.includes(mapping))
      throw new ScaffoldError(
        "HFS_ADD_INBOX_DATABASE",
        "platform/database has an unknown error-family shape",
      );
    error = error
      .replace(after, `${after}\n    /** A signed delivery omitted the provider's non-empty idempotency key. */\n${enumLine}`)
      .replace(
        mapping,
        `${mapping}\n    [DatabaseErrorCode.WebhookDeliveryIdRequired]: "invalid",`,
      );
  }
  return [
    { file: indexFile, text: index },
    { file: errorFile, text: error },
  ];
};

/** The first webhook installs only the lite inbox claim and the pgmq event bus, shared by all providers. */
const handoffPlatformFiles = (root: string, values: Readonly<Record<string, string>>): PlannedFile[] => {
  const planned: PlannedFile[] = [];
  for (const capability of ["inbox", "idempotency", "event-bus"]) {
    const base = `be/src/modules/platform/${capability}`;
    if (fs.existsSync(path.join(root, base, "index.ts"))) {
      // The provider intake claims through the EntityInbox port; an inbox written before it cannot serve a new provider.
      if (capability === "inbox" && !fs.readFileSync(path.join(root, base, "index.ts"), "utf8").includes("InjectEntityInbox"))
        throw new ScaffoldError(
          "HFS_ADD_INBOX_ENTITY_PORT",
          `${base} predates the EntityInbox port (InjectEntityInbox, claimRow) the ${values.provider} intake claims through; bring it to the inbox of this hfs first`,
        );
      continue;
    }
    const folder = path.join(TEMPLATES_DIR, "be", "inbox", "platform", capability);
    for (const file of filesBelow(folder)) {
      const relative = path.relative(folder, file).replaceAll("\\", "/");
      planned.push({
        relative: `${base}/${relative.replace(/\.tpl$/, "")}`,
        text: template(`platform/${capability}/${relative}`, values),
      });
    }
  }
  return planned;
};

/** A provider may already publish other events; retain its barrel and contract when adding the receipt event. */
const eventFiles = (root: string, provider: string, values: Readonly<Record<string, string>>): { planned: PlannedFile[], patches: Patch[] } => {
  const entries = [
    { relative: `be/src/modules/events/${provider}/index.ts`, text: template("event-index.ts.tpl", values) },
    { relative: `be/contracts/${provider}/events.json`, text: template("events.json.tpl", values) },
  ];
  const planned: PlannedFile[] = [];
  const patches: Patch[] = [];
  for (const entry of entries) {
    const file = path.join(root, ...entry.relative.split("/"));
    if (!fs.existsSync(file)) {
      planned.push(entry);
      continue;
    }
    const previous = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    if (entry.relative.endsWith("index.ts")) {
      patches.push({ file, text: previous.includes(entry.text.trim()) ? previous : `${previous.trimEnd()}\n${entry.text}` });
    } else {
      const contract = JSON.parse(previous);
      if (contract.schema !== "starci/event-contract@1" || contract.service !== provider || !contract.events || Array.isArray(contract.events) || typeof contract.events !== "object")
        throw new ScaffoldError("HFS_ADD_EVENT_CONTRACT", `${entry.relative} is not the event contract of ${provider}`);
      const additions = JSON.parse(entry.text).events;
      contract.events = { ...contract.events, ...additions };
      patches.push({ file, text: jsonText(contract) });
    }
  }
  return { planned, patches };
};

/** The lite entity list (BE-PERSISTENCE-3), where the provider inbox's `<provider>InboxEntities` is spread once. */
const PRIMARY_ENTITIES_FILE = ["be", "src", "modules", "platform", "database", "entities.ts"];
const PRIMARY_ENTITIES = /(export const PRIMARY_ENTITIES[^=]*=\s*\[)([\s\S]*?)(\])/;

/** entities.ts with the receipt entity list imported from the provider inbox barrel and spread into PRIMARY_ENTITIES. */
const primaryEntitiesPatch = (root: string, provider: string, list: string): Patch => {
  const file = path.join(root, ...PRIMARY_ENTITIES_FILE);
  const relative = PRIMARY_ENTITIES_FILE.join("/");
  if (!fs.existsSync(file))
    throw new ScaffoldError("HFS_ADD_INBOX_DATABASE", `lite add webhook names ${list} in PRIMARY_ENTITIES of ${relative}, which is missing`);
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (!PRIMARY_ENTITIES.test(text))
    throw new ScaffoldError("HFS_ADD_INBOX_DATABASE", `lite add webhook names ${list} in PRIMARY_ENTITIES of ${relative}, which declares no PRIMARY_ENTITIES array`);
  if (new RegExp(String.raw`\.\.\.${list}\b`).test(text)) return { file, text };
  const withList = text.replace(PRIMARY_ENTITIES, (_all: string, head: string, items: string, tail: string) =>
    `${head}${[...items.split(",").map((item) => item.trim()).filter(Boolean), `...${list}`].join(", ")}${tail}`);
  const lines = withList.split("\n");
  const lastImport = lines.reduce((at, line, index) => (line.startsWith("import ") ? index : at), -1);
  lines.splice(lastImport + 1, 0, `import { ${list} } from "@modules/domain/${provider}-inbox"`);
  return { file, text: lines.join("\n") };
};

const eventPatternPatch = (root: string): Patch => {
  const file = path.join(root, "hfs.json");
  const declaration = JSON.parse(fs.readFileSync(file, "utf8"));
  declaration.sides.be.patterns = [...new Set([...(declaration.sides.be.patterns ?? []), "event-bus"])].sort(byCodeUnit);
  return { file, text: jsonText(declaration) };
};

/** Writes the lite provider inbox. Processing belongs to a separately added reactor or job, after the record commits. */
export function addLiteWebhookInbox({
  root,
  repo,
  noun,
  provider,
  values,
  now = Date.now,
}: {
  root: string;
  repo: { edition?: string };
  noun: string;
  provider: string;
  values: InboxValues;
  now?: () => number;
}): string[] {
  if (repo.edition !== "lite" || noun !== "webhook") return [];
  validateProcessingOwner({ root, service: values.service!, serviceModule: values.serviceModule!, provider }); // a webhook always carries its processing service
  const Provider = pascalOf(provider);
  const table = `${snakeOf(provider)}_inbox`;
  const migrationsDir = path.join(root, "db", "migrations");
  const migrations = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((file) => MIGRATION.test(file)).sort(byCodeUnit)
    : [];
  const suffix = `${provider}-inbox.sql`;
  if (migrations.some((file) => file.endsWith(`_${suffix}`)))
    throw new ScaffoldError(
      "HFS_ADD_EXISTS",
      `webhook ${provider} already has an inbox migration`,
    );
  const latest = migrations.at(-1)?.slice(0, 14);
  const stamp = nextMigrationStamp(now, latest);
  const renderValues = {
    ...values,
    provider,
    Provider,
    providerCamel: camelOf(provider),
    providerUpper: upperOf(provider),
    table,
  };
  const base = `be/src/modules/domain/${provider}-inbox`;
  const events = eventFiles(root, provider, renderValues);
  const planned: PlannedFile[] = [
    {
      relative: `db/migrations/${stamp}_${suffix}`,
      text: template("migration.sql.tpl", renderValues),
    },
    { relative: `${base}/index.ts`, text: template("index.ts.tpl", renderValues) },
    {
      relative: `${base}/${provider}-inbox.module-definition.ts`,
      text: template("module-definition.ts.tpl", renderValues),
    },
    {
      relative: `${base}/${provider}-inbox.options.ts`,
      text: template("options.ts.tpl", renderValues),
    },
    {
      relative: `${base}/${provider}-inbox.module.ts`,
      text: template("module.ts.tpl", renderValues),
    },
    {
      relative: `${base}/${provider}-inbox.service.ts`,
      text: template("service.ts.tpl", renderValues),
    },
    {
      relative: `${base}/${provider}-inbox.service.spec.ts`,
      text: template("service.spec.ts.tpl", renderValues),
    },
    {
      relative: `${base}/persistence/entities/${provider}-inbox.entity.ts`,
      text: template("entity.ts.tpl", renderValues),
    },
    {
      relative: `${base}/persistence/entities/index.ts`,
      text: template("entities.index.ts.tpl", renderValues),
    },
    {
      relative: `be/src/modules/events/${provider}/${provider}-delivery-recorded.event.ts`,
      text: template("delivery-recorded.event.ts.tpl", renderValues),
    },
    ...events.planned,
    ...handoffPlatformFiles(root, renderValues),
  ];
  const hasHandoffStorage = migrations.some((file) =>
    /create\s+function\s+public\.event_bus_send\b/i.test(fs.readFileSync(path.join(migrationsDir, file), "utf8")),
  );
  if (!hasHandoffStorage)
    planned[0]!.text = `${template("platform/migration.sql.tpl", renderValues)}\n${template("platform/client-operation-outcomes.sql.tpl", renderValues)}\n${planned[0]!.text}`; // the migration is the first planned file
  // The sql tag and the database-function call (with its spec) the inbox and the event bus use; the lite starter leaves them out.
  for (const file of ["database.sql.ts", "database.client.ts", "database.client.spec.ts"]) {
    const relative = `be/src/modules/platform/database/${file}`;
    if (fs.existsSync(path.join(root, ...relative.split("/")))) continue;
    planned.push({
      relative,
      text: render(fs.readFileSync(path.join(TEMPLATES_DIR, "be", "skeleton-lite", "src", "modules", "platform", "database", file), "utf8"), {}),
    });
  }
  const clashes = planned
    .filter((entry) => fs.existsSync(path.join(root, ...entry.relative.split("/"))))
    .map((entry) => entry.relative);
  if (clashes.length)
    throw new ScaffoldError(
      "HFS_ADD_EXISTS",
      `webhook ${provider} inbox already exists: ${clashes.join(", ")}`,
    );
  const patches = [
    ...databasePatches(root),
    primaryEntitiesPatch(root, provider, `${renderValues.providerCamel}InboxEntities`),
    ...events.patches,
    eventPatternPatch(root),
  ];
  for (const entry of planned) {
    const target = path.join(root, ...entry.relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.text);
  }
  for (const patch of patches) fs.writeFileSync(patch.file, patch.text);
  return planned.map((entry) => entry.relative);
}
