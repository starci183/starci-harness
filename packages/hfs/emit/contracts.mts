/**
 * `starci app emit`: writes `contracts/<service>/events.json` for every service that declares typed event classes under
 * `src/modules/events/<service>/` (events.mts: the async contract, R166), `contracts/<app>/schema.graphql` for every api app of hfs.json that serves GraphQL, and
 * `contracts/<app>/openapi.json` for every api app whose `apps/<app>/src/operations.ts` exports the typed operation table
 * `OPERATIONS` (operations.mts: OpenAPI 3.1 derived from zod schema modules, with closed refusal codes proved by the checker). An api app
 * whose hfs.json entry declares `contract: "rest"` gets `contracts/<app>/openapi.json` alone: the OpenAPI 3 document of its controllers
 * (rest-worker.mts, Nest's own @nestjs/swagger over the head `apps/<app>/src/openapi.ts`); no GraphQL schema or operation table is read for it.
 *
 * The GraphQL snapshot prints the lexicographically sorted schema with class-validator bounds on input fields as
 * `@inputBounds` directives. OpenAPI carries the equivalent JSON Schema property and item constraints. It needs no
 * environment, no database and no network, and never boots the app.
 *
 * What an app serves is decided from its source (`static-graph.mts`): the module graph is walked from `AppModule` of
 * `apps/<app>/src/app.module.ts` through every import (imports of imports, `register`/`forRoot`/`forRootAsync` dynamic modules,
 * `forwardRef`, spreads and both branches of a conditional), and the resolver providers of the modules the GraphQL server reads
 * (all of them, or the `include` whitelist and its imports) are the resolvers of the contract. The schema itself comes from
 * Nest's own `GraphQLSchemaFactory` (the builder the running server uses) over those classes, compiled the way `tsc` compiles
 * them. An app whose graph holds no GraphQL server is skipped; an app whose graph cannot be decided is an error.
 *
 * TypeScript, Nest and graphql are the repository's own packages; nothing is added to the managed devDependencies. Every app
 * runs in its own child process (`schema-worker.mts`) because Nest GraphQL's type metadata is process-global.
 *
 * * artifact, so a redirected `outDir` (the R23 check mode, which emits into a scratch root) does not get them.
 */
import { spawnSync } from 'node:child_process';
import { completedNode, runHeavyNode, type HeavyNodeResult, type HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitEvents, eventServices, eventsSnapshotPath } from './events.mjs';
import { openapiPath } from './operations.mjs';
import { contractOf } from '../runtime/scripts/hfs/contract-kind.mjs';
import { readEnv } from '../runtime/scripts/lib/env.mjs';

/** The parts of the parsed hfs.json this module reads. */
export interface HfsDeclaration {
  readonly apps?: ReadonlyArray<{ readonly name: string; readonly kind: string; readonly contract?: string }>;
}

/** The stderr prefix of a dependency the worker could not load and stood in for. */
const STAND_IN = 'stand-in ';
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema-worker.mjs');
const OPERATIONS_WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'operations-worker.mjs');
const REST_WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rest-worker.mjs');

/** The repository-relative path of an app's root module. */
export const appModulePath = (app: string) => `apps/${app}/src/app.module.ts`;

/** The repository-relative path of an app's snapshot. */
const snapshotPath = (app: string) => `contracts/${app}/schema.graphql`;

/** A tsconfig `paths` alias: its prefix and the absolute bases it maps to. */
export interface PathAlias {
  readonly prefix: string;
  readonly targets: readonly string[];
}

/** The `paths` aliases of a tsconfig as [{ prefix, targets }], `@modules/*` giving prefix `@modules/`. Pure. */
export function aliasesOf(paths: Readonly<Record<string, readonly string[]>> | undefined, baseDir: string): PathAlias[] {
  return Object.entries(paths ?? {})
    .filter(([pattern]) => pattern.endsWith('/*'))
    .map(([pattern, targets]) => ({ prefix: pattern.slice(0, -1), targets: targets.map((target) => path.resolve(baseDir, target.replace(/\*$/, ''))) }));
}

/** The absolute base a specifier resolves to through the aliases, or null when it is not aliased. Pure. */
export function aliasTarget(aliases: readonly PathAlias[], specifier: string): string | null {
  const alias = aliases.find((item) => specifier.startsWith(item.prefix));
  return alias ? path.join(alias.targets[0]!, specifier.slice(alias.prefix.length)) : null;
}

/** The api apps of a declaration: kind `api`, with the contract each serves (contract-kind.mts). Pure. */
const apiApps = (declaration: HfsDeclaration) => (declaration.apps ?? []).filter((app) => app.kind === 'api').map((app) => ({ name: app.name, contract: contractOf(app) }));

/** The text written to a snapshot file: the printed schema and one final newline. Pure. */
export const snapshotText = (printed: string) => `${printed.replace(/\n+$/, '')}\n`;

interface WorkerRequest { worker: string; repoRoot: string; app: string }
interface WorkerOutput { text: string | null; lines: string[] }
interface EmitInput { repoRoot: string; declaration: HfsDeclaration; outDir?: string }
interface EmitResult { written: string[]; skipped: string[]; standIns: Record<string, string[]> }

/** Both transports judge the same native worker status and exact text. Exit 3 means the app serves no such contract. */
function workerOutput(result: Pick<HeavyNodeResult, 'status' | 'stdout' | 'stderr'>, app: string): WorkerOutput {
  if (result.status === 3) return { text: null, lines: [] };
  const lines = (result.stderr ?? '').split(/\r?\n/).filter(Boolean);
  if (result.status !== 0) throw new Error(`starci app emit: ${app} failed (exit ${result.status}): ${(lines.join('\n') || result.stdout).trim()}`);
  return { text: result.stdout, lines: lines.filter((line) => line.startsWith(STAND_IN)) };
}

/**
 * Writes the snapshots of every api app: `contracts/<app>/schema.graphql` when it serves GraphQL and `contracts/<app>/openapi.json`
 * when it has an operation table. Answers `{ written: [paths], skipped: [apps], standIns: { app: [lines] } }`, `skipped`
 * being the apps with neither. `declaration` is the parsed hfs.json. `outDir` (absolute) redirects the snapshots to another
 * root, keeping their relative paths.
 */
function* emissionProgram({ repoRoot, declaration, outDir = repoRoot }: EmitInput): Generator<WorkerRequest, EmitResult, WorkerOutput> {
  const written: string[] = [];
  const skipped: string[] = [];
  const standIns: Record<string, string[]> = {};
  for (const { name: app, contract } of apiApps(declaration)) {
    if (contract === 'rest') {
      const rest = yield { worker: REST_WORKER, repoRoot, app };
      const target = path.join(outDir, openapiPath(app));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, snapshotText(rest.text ?? ''));
      written.push(openapiPath(app));
      if (rest.lines.length) standIns[app] = rest.lines;
      continue;
    }
    const graphql = yield { worker: WORKER, repoRoot, app };
    const operations = yield { worker: OPERATIONS_WORKER, repoRoot, app };
    const emitted = { graphql: graphql.text, openapi: operations.text, standIns: [...graphql.lines, ...operations.lines] };
    if (emitted.graphql === null && emitted.openapi === null) {
      skipped.push(app);
      continue;
    }
    const snapshots: Array<[string | null, string]> = [[emitted.graphql, snapshotPath(app)], [emitted.openapi, openapiPath(app)]];
    for (const [text, relative] of snapshots) {
      if (text === null) continue;
      const target = path.join(outDir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, snapshotText(text));
      written.push(relative);
    }
    if (emitted.standIns.length) standIns[app] = emitted.standIns;
  }
  for (const service of eventServices(repoRoot)) {
    const events = emitEvents({ repoRoot, service });
    if (events === null) continue;
    const relative = eventsSnapshotPath(service);
    const target = path.join(outDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, events);
    written.push(relative);
  }
  return { written, skipped, standIns };
}


/** Existing synchronous emitter for source finders and their worker proofs. */
export function emitContracts(input: EmitInput): EmitResult {
  const program = emissionProgram(input);
  let step = program.next();
  while (!step.done) {
    const { worker, repoRoot, app } = step.value;
    const result = spawnSync(process.execPath, [worker, repoRoot, app], { encoding: 'utf8', cwd: repoRoot, env: { PATH: readEnv('PATH') ?? '' }, maxBuffer: 256 * 1024 * 1024 });
    step = program.next(workerOutput(result, app));
  }
  return step.value;
}

/** App-check/emit execution: each actual compiler worker is admitted separately, with the original isolated environment. */
export async function emitContractsAsync(input: EmitInput & { execute?: HeavyNodeRun | undefined }): Promise<EmitResult> {
  const program = emissionProgram(input);
  let step = program.next();
  while (!step.done) {
    const { worker, repoRoot, app } = step.value;
    const result = completedNode(await runHeavyNode(input.execute, { kind: 'tsc', label: `app emit ${app} ${path.basename(worker)}`, args: [worker, repoRoot, app], cwd: repoRoot, env: { PATH: readEnv('PATH') ?? '' }, maxBuffer: 256 * 1024 * 1024 }), 'contract compiler');
    step = program.next(workerOutput(result, app));
  }
  return step.value;
}
