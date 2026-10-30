import type { ArchitectureViolation, GraphFile } from './hfs-graph.mjs';
import type { CheckResult, ComposedConnection, ContextModel, DeclaredConnection, HfsCheckInput, MachineKit, SlotResolver } from './context-map.mjs';
import { contextModelOf, connectionsComposedBy } from './context-map.mjs';
import { machineKit } from './machine-ast.mjs';

/**
 * R174 `context-owner` (BE_CONTEXT_OWNER). A connection of hfs.json IS a bounded context, and its `owner` is the one service app that composes it:
 *   - an api or worker app passes to the database module registration (or lists in its options) only the connections it owns (a monolith's one
 *     app owns them all);
 *   - an api or worker app imports no domain or projection capability of a context it does not own: it composes only its own contexts;
 *   - the cli app is the migration runner and composes every declared connection
 *     that holds registered tables (migrations run only through it, once per connection).
 * Which connection an app composes is read from two typed origins in its own files: the connection passed to the database module registration
 * and the connection literal that lists a capability's `<c>Entities` / `<c>Migrations`. Which context a capability belongs to is the connection
 * its arrays are registered on (context-map.mjs); an import is judged by the owner graph edge and the target's slot tier, never by a path or
 * name pattern. A runner app with a registration whose connection name cannot be resolved is not judged for missing connections.
 */
export const CONTEXT_OWNER_RULE_IDS = ['BE_CONTEXT_OWNER'];

const RULE = 'BE_CONTEXT_OWNER';
const SERVICE_KINDS = new Set(['api', 'worker']);
const RUNNER_KINDS = new Set(['migrate', 'cli']);

/** An app of hfs.json. */
interface AppRecord {
  name: string;
  kind: string;
}

/** What one app composes: the connections it passes on, and whether a registration's connection name could not be resolved. */
interface Composition {
  items: ComposedConnection[];
  unresolved: boolean;
}

/** A finding without its rule id. */
interface ViolationBody {
  message: string;
  path?: string;
  line?: number;
  column?: number;
  [extra: string]: unknown;
}

/** What the judgement of one app's composition reads and reports through. */
interface CompositionJudgement {
  owners: Map<string, string>;
  model: ContextModel;
  kit: MachineKit;
  once: (key: string, violation: ViolationBody) => void;
}

// What each app composes: [{connection, file, node}] from the database module registration and from the registration literals under its files.
const compositionsOf = (kit: MachineKit, resolver: SlotResolver, model: ContextModel, appOf: (rel: string) => string | null): Map<string, Composition> => {
  const apps: AppRecord[] = resolver.repo.apps;
  const composed = new Map<string, Composition>(apps.map((app): [string, Composition] => [app.name, { items: [], unresolved: false }]));
  for (const app of apps) {
    const entry = composed.get(app.name);
    if (!entry) continue;
    for (const item of connectionsComposedBy(kit, app.name).items) entry.items.push(item);
  }
  for (const site of model.registrations) {
    const app = appOf(site.file.rel);
    const entry = app ? composed.get(app) : undefined;
    if (!app || !entry) continue;
    if (site.connection === null) entry.unresolved = true;
    else entry.items.push({ connection: site.connection, file: site.file, node: site.node });
  }
  return composed;
};

// A service app composes only the connections it owns; a runner app composes every declared connection with tables.
const judgeComposition = (app: AppRecord, { items, unresolved }: Composition, { owners, model, kit, once }: CompositionJudgement): number => {
  if (SERVICE_KINDS.has(app.kind)) {
    for (const { connection, file, node } of items) {
      const owner = owners.get(connection);
      if (owner && owner !== app.name) {
        once(`${app.name}|${connection}`, { ...kit.at(file.rel, file.sourceFile, node), message: `App ${app.name} composes connection ${connection}, the context owned by app ${owner}; an app composes only the contexts it owns. Reach that context through the API or the events of ${owner}.`, connection, app: app.name, owner });
      }
    }
  } else if (RUNNER_KINDS.has(app.kind) && !unresolved) {
    const root: GraphFile | null = kit.appRoot(app.name);
    const present = new Set(items.map(item => item.connection));
    const held = new Set([...model.registered.values()].flatMap(entry => [...entry.connections.keys()]));
    for (const connection of owners.keys()) {
      if (!root || present.has(connection) || !held.has(connection) || !items.length) continue;
      once(`${app.name}|missing|${connection}`, { ...kit.at(root.rel, root.sourceFile, root.sourceFile), message: `The ${app.kind} app ${app.name} does not compose connection ${connection}; migrations run only through it, once per connection, so it registers every declared connection that holds tables.`, connection, app: app.name });
    }
  }
  return items.length;
};

export function checkContextOwner(input: HfsCheckInput): CheckResult {
  const { graph } = input;
  const kit = machineKit(input);
  const { resolver } = kit;
  const model = contextModelOf(kit, graph);
  const violations: ArchitectureViolation[] = [];
  const connections: DeclaredConnection[] = resolver.repo.connections;
  const apps: AppRecord[] = resolver.repo.apps;
  const owners = new Map<string, string>(connections.map((connection): [string, string] => [connection.name, connection.owner]));
  let compositions = 0;
  let imports = 0;
  const seen = new Set<string>();
  const once = (key: string, violation: ViolationBody): void => { if (!seen.has(key)) { seen.add(key); violations.push({ ruleId: RULE, ...violation }); } };
  const appOf = (rel: string): string | null => { const classified = resolver.classifyPath(rel); return classified.slot?.startsWith('be.app.') ? classified.bindings?.app ?? null : null; };

  const composed = compositionsOf(kit, resolver, model, appOf);

  for (const app of apps) {
    const composition = composed.get(app.name);
    if (composition) compositions += judgeComposition(app, composition, { owners, model, kit, once });
  }

  const kinds = new Map<string, string>(apps.map((app): [string, string] => [app.name, app.kind]));
  for (const edge of graph.edges) {
    const app = appOf(edge.from);
    if (!app || !SERVICE_KINDS.has(kinds.get(app) ?? '')) continue;
    const context = model.contextOfFile(edge.to);
    if (!context) continue;
    imports += 1;
    const owner = owners.get(context);
    if (owner && owner !== app) {
      once(`${edge.from}|${edge.to}`, { path: edge.from, line: edge.line, column: edge.column, message: `App ${app} imports ${graph.files.get(edge.to)?.owner.root}, a capability of context ${context} owned by app ${owner}; an app composes only the contexts it owns, so use the API or the events of ${owner} instead.`, connection: context, app, owner });
    }
  }
  return { violations, coverage: { status: 'checked', apps: apps.length, compositions, contextImports: imports } };
}
