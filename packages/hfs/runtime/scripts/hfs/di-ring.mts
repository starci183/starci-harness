// R401 BE_DI_RING: a provider ring is found before Nest is asked to build it. Nest 11 names a ring of two providers
// (CircularDependencyException) but waits forever on a ring of three or more, so an app that holds one hangs at boot with no error.
// The wiring proof's worker (app-wiring.mts) registers the real composition root with Nest's own DependenciesScanner, which records the
// module graph and instantiates nothing, and this module walks what it recorded: every provider's construction edges, resolved to the
// provider Nest would inject with Nest's own lookup (the module's providers, then its imports, descending only through re-exported
// modules; scan binds every global module as an import of every module).
//
// A construction edge is what Nest awaits before it constructs a provider: a constructor parameter (`design:paramtypes`, overridden by
// `@Inject`), an `@Inject` property, an entry of a `useFactory` `inject` list, and the one target of a `useExisting` alias. An `@Optional`
// dependency is an edge when it resolves (Nest awaits it then) and none when it does not. A `forwardRef` dependency is no edge: Nest
// defers it, and resolves a ring it closes whatever the ring's length, through a class, a `useExisting` alias or a factory; R85
// (`no-forward-ref`) refuses forwardRef in product code, so such a ring is that rule's finding, never this one. A self edge is
// Nest's own refusal (UnknownDependenciesException) and no ring.
import path from 'node:path';

/** The metadata keys of `@nestjs/common/constants` the walk reads, taken from the app's own installed Nest. */
export interface NestConstants {
  readonly PARAMTYPES_METADATA: string; readonly SELF_DECLARED_DEPS_METADATA: string; readonly OPTIONAL_DEPS_METADATA: string;
  readonly PROPERTY_DEPS_METADATA: string; readonly OPTIONAL_PROPERTY_DEPS_METADATA: string;
}

/** The parts of a provider wrapper Nest's scanner recorded that the walk reads. */
export interface ScannedWrapper { readonly metatype?: unknown; readonly inject?: readonly unknown[] | null | undefined; readonly isAlias?: boolean | undefined }

/** The parts of a scanned Nest module the walk reads. */
export interface ScannedModule {
  readonly id: string; readonly name: string; readonly metatype: unknown;
  readonly providers: ReadonlyMap<unknown, ScannedWrapper>; readonly imports: ReadonlySet<ScannedModule | null | undefined>; readonly exports: ReadonlySet<unknown>;
}

/** One provider of a ring and how it reaches the next one: its token, its module, its source file (relative, or null) and the edge. */
export interface RingStep { readonly token: string; readonly module: string; readonly file: string | null; readonly via: string }

/** One elementary ring, from the provider whose name sorts first, each step injecting the next and the last injecting the first. */
export interface ProviderRing { readonly steps: readonly RingStep[] }

/** The most rings one app reports, and the most search steps their enumeration takes; a larger tangle is reported in part. */
export const RING_LIMIT = 20;
const SEARCH_BUDGET = 200_000;

interface Injection { readonly token: unknown; readonly optional: boolean; readonly via: string }
interface Edge { readonly to: string; readonly via: string }
interface ProviderNode { readonly key: string; readonly token: unknown; readonly module: ScannedModule; readonly wrapper: ScannedWrapper; readonly edges: Edge[] }

/** A token as a reader names it: a class by its name, a symbol by its description, a string quoted. */
export function tokenName(token: unknown): string {
  if (typeof token === 'function') return (token as { name?: string }).name || '<anonymous class>';
  if (typeof token === 'symbol') return token.toString();
  return typeof token === 'string' ? JSON.stringify(token) : String(token);
}

const isForward = (raw: unknown): boolean => typeof raw === 'object' && raw !== null && typeof (raw as { forwardRef?: unknown }).forwardRef === 'function';

/** An OptionalFactoryDependency `{ token, optional }` of a factory's inject list. */
const optionalEntry = (raw: unknown): { token: unknown; optional: boolean } | null =>
  typeof raw === 'object' && raw !== null && 'token' in raw && !isForward(raw) ? { token: (raw as { token: unknown }).token, optional: (raw as { optional?: unknown }).optional === true } : null;

const metadata = (key: string, target: object): unknown => Reflect.getMetadata(key, target);

/** The construction edges of one provider, before resolution; forwardRef dependencies are left out (see the head comment). */
export function injectionsOf(wrapper: ScannedWrapper, keys: NestConstants): Injection[] {
  if (Array.isArray(wrapper.inject)) {
    return wrapper.inject.flatMap((raw: unknown, at: number) => {
      const entry = optionalEntry(raw) ?? { token: raw, optional: false };
      return isForward(entry.token) ? [] : [{ token: entry.token, optional: entry.optional, via: wrapper.isAlias ? 'useExisting' : `useFactory inject[${at}]` }];
    });
  }
  const type = wrapper.metatype;
  if (typeof type !== 'function' || (wrapper.inject !== null && wrapper.inject !== undefined)) return [];
  const params = [...((metadata(keys.PARAMTYPES_METADATA, type) as unknown[] | undefined) ?? [])];
  const declared = new Set<number>();
  for (const { index, param } of (metadata(keys.SELF_DECLARED_DEPS_METADATA, type) as { index: number; param: unknown }[] | undefined) ?? []) {
    params[index] = param;
    declared.add(index);
  }
  const optional = new Set((metadata(keys.OPTIONAL_DEPS_METADATA, type) as number[] | undefined) ?? []);
  const found: Injection[] = params.flatMap((token, index) => isForward(token) ? [] : [{ token, optional: optional.has(index), via: `${declared.has(index) ? '@Inject ' : ''}constructor[${index}]` }]);
  const optionalKeys = new Set((metadata(keys.OPTIONAL_PROPERTY_DEPS_METADATA, type) as unknown[] | undefined) ?? []);
  for (const { key, type: token } of (metadata(keys.PROPERTY_DEPS_METADATA, type) as { key: string | symbol; type: unknown }[] | undefined) ?? []) {
    if (!isForward(token)) found.push({ token, optional: optionalKeys.has(key), via: `@Inject property ${String(key)}` });
  }
  return found;
}

/** Nest's own lookup (Injector.lookupComponent, then lookupComponentInImports): the module that provides `token` to `module`, or null. */
export function providingModule(module: ScannedModule, token: unknown): ScannedModule | null {
  if (module.providers.has(token)) return module;
  const seen = new Set<string>();
  const walk = (current: ScannedModule, traversing: boolean): ScannedModule | null => {
    let children = [...current.imports].filter((child): child is ScannedModule => Boolean(child));
    if (traversing) children = children.filter((child) => current.exports.has(child.metatype));
    for (const related of children) {
      if (seen.has(related.id)) continue;
      seen.add(related.id);
      if (related.exports.has(token) && related.providers.has(token)) return related;
      const deeper = walk(related, true);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(module, false);
}

/** The provider graph of the scanned modules (the internal core module aside): one node per module and token, each with its resolved edges. */
export function providerGraph(modules: readonly ScannedModule[], keys: NestConstants): Map<string, ProviderNode> {
  const keyOf = (module: ScannedModule, token: unknown, ids: Map<unknown, number>): string => {
    if (!ids.has(token)) ids.set(token, ids.size);
    return `${module.id}::${ids.get(token)}`;
  };
  const ids = new Map<unknown, number>();
  const nodes = new Map<string, ProviderNode>();
  for (const module of modules) {
    for (const [token, wrapper] of module.providers) nodes.set(keyOf(module, token, ids), { key: keyOf(module, token, ids), token, module, wrapper, edges: [] });
  }
  for (const node of nodes.values()) {
    for (const injection of injectionsOf(node.wrapper, keys)) {
      // An absent type (a file import ring, a missing @Inject) is Nest's own refusal at compile, never an edge here.
      if (injection.token === undefined || injection.token === Object || injection.token === node.token) continue;
      const host = providingModule(node.module, injection.token);
      if (!host) continue;
      const to = keyOf(host, injection.token, ids);
      if (nodes.has(to)) node.edges.push({ to, via: injection.via });
    }
  }
  return nodes;
}

/** Tarjan's strongly connected components of two or more nodes, iteratively (a provider graph is deep). */
function components(nodes: ReadonlyMap<string, ProviderNode>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const info = new Map<string, { index: number; low: number; on: boolean }>();
  const out: string[][] = [];
  const open = (key: string): void => { info.set(key, { index, low: index, on: true }); index += 1; stack.push(key); };
  for (const start of nodes.keys()) {
    if (info.has(start)) continue;
    open(start);
    const work: { key: string; at: number }[] = [{ key: start, at: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const edges = nodes.get(frame.key)!.edges;
      if (frame.at < edges.length) {
        const next = edges[frame.at]!.to;
        frame.at += 1;
        if (!info.has(next)) { open(next); work.push({ key: next, at: 0 }); }
        else if (info.get(next)!.on) info.get(frame.key)!.low = Math.min(info.get(frame.key)!.low, info.get(next)!.index);
        continue;
      }
      work.pop();
      const mine = info.get(frame.key)!;
      if (work.length > 0) { const parent = info.get(work[work.length - 1]!.key)!; parent.low = Math.min(parent.low, mine.low); }
      if (mine.low !== mine.index) continue;
      const component: string[] = [];
      let member: string;
      do { member = stack.pop()!; info.get(member)!.on = false; component.push(member); } while (member !== frame.key);
      if (component.length > 1) out.push(component);
    }
  }
  return out;
}

/** Every elementary ring of a component (Johnson's order: each ring once, from its least member), bounded by RING_LIMIT and the search budget. */
function elementaryRings(nodes: ReadonlyMap<string, ProviderNode>, component: readonly string[], order: (key: string) => string, limit: number): Edge[][] {
  const members = [...component].sort((a, b) => order(a).localeCompare(order(b)) || a.localeCompare(b));
  const rank = new Map(members.map((key, at) => [key, at]));
  const rings: Edge[][] = [];
  let budget = SEARCH_BUDGET;
  for (const start of members) {
    const floor = rank.get(start)!;
    const path: Edge[] = [];
    const onPath = new Set<string>([start]);
    const visit = (key: string): void => {
      for (const edge of nodes.get(key)!.edges) {
        if (rings.length >= limit || budget <= 0) return;
        budget -= 1;
        const at = rank.get(edge.to);
        if (at === undefined || at < floor) continue;
        if (edge.to === start) { rings.push([...path, edge]); continue; }
        if (onPath.has(edge.to)) continue;
        onPath.add(edge.to); path.push(edge);
        visit(edge.to);
        path.pop(); onPath.delete(edge.to);
      }
    };
    visit(start);
    if (rings.length >= limit || budget <= 0) break;
  }
  return rings;
}

/** Where a provider is written: the source file (relative to the back end) that exports its class, its token or its module, or null. */
export type SourceOf = (value: unknown) => string | null;

/** Every elementary provider ring of length two or more in the scanned modules, each from the member whose name sorts first. */
export function providerRings(modules: readonly ScannedModule[], keys: NestConstants, sourceOf: SourceOf = () => null, limit = RING_LIMIT): ProviderRing[] {
  const nodes = providerGraph(modules, keys);
  const label = (key: string): string => tokenName(nodes.get(key)!.token);
  const rings: ProviderRing[] = [];
  for (const component of components(nodes)) {
    for (const ring of elementaryRings(nodes, component, label, limit - rings.length)) {
      let from = ring[ring.length - 1]!.to;
      rings.push({ steps: ring.map((edge) => {
        const node = nodes.get(from)!;
        from = edge.to;
        const file = sourceOf(node.wrapper.metatype) ?? sourceOf(node.token) ?? sourceOf(node.module.metatype);
        return { token: tokenName(node.token), module: node.module.name, file, via: edge.via };
      }) });
    }
    if (rings.length >= limit) break;
  }
  return rings;
}

/** The source index of the modules a loader holds: each exported class or symbol mapped to the file under `root` that declares it, a barrel (index) only when nothing else does. */
export function sourceIndex(cache: Record<string, { exports?: unknown } | undefined>, root: string): SourceOf {
  const index = new Map<unknown, string>();
  const isBarrel = (file: string): boolean => /^index\.[cm]?[jt]s$/u.test(path.basename(file));
  for (const [file, loaded] of Object.entries(cache)) {
    const relative = path.relative(root, file);
    if (!loaded?.exports || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).includes('node_modules')) continue;
    if (typeof loaded.exports !== 'object' && typeof loaded.exports !== 'function') continue;
    for (const value of Object.values(loaded.exports as Record<string, unknown>)) {
      if (typeof value !== 'function' && typeof value !== 'symbol') continue;
      const held = index.get(value);
      if (held === undefined || (isBarrel(held) && !isBarrel(relative))) index.set(value, relative.split(path.sep).join('/'));
    }
  }
  return (value) => index.get(value) ?? null;
}

/** The ring as one line: `A -> B -> C -> A`. */
export const ringChain = (ring: ProviderRing): string => [...ring.steps.map((step) => step.token), ring.steps[0]?.token ?? ''].join(' -> ');

/**
 * Registers `root` (a module class or the dynamic module its `register` returned) with the app's own Nest scanner, which instantiates
 * nothing, and returns its provider rings. `require` is the app's loader, so the scan reads the Nest the app installs.
 */
export async function scanProviderRings(root: unknown, require: NodeJS.Require, sourceOf: SourceOf): Promise<ProviderRing[]> {
  // reason: Nest's container and scanner are deep CommonJS exports of the app's own @nestjs/core, with no types this package declares.
  const { NestContainer } = require('@nestjs/core/injector/container') as { NestContainer: new (config: unknown) => { getModules(): Map<string, ScannedModule>; getInternalCoreModuleRef(): unknown } };
  const { DependenciesScanner } = require('@nestjs/core/scanner') as { DependenciesScanner: new (...args: unknown[]) => { scan(module: unknown): Promise<void> } };
  const { MetadataScanner } = require('@nestjs/core/metadata-scanner') as { MetadataScanner: new () => unknown };
  const { GraphInspector } = require('@nestjs/core/inspector/graph-inspector') as { GraphInspector: new (container: unknown) => unknown };
  const { ApplicationConfig } = require('@nestjs/core/application-config') as { ApplicationConfig: new () => unknown };
  const keys = require('@nestjs/common/constants') as NestConstants;
  const config = new ApplicationConfig();
  const container = new NestContainer(config);
  await new DependenciesScanner(container, new MetadataScanner(), new GraphInspector(container), config).scan(root);
  const core = container.getInternalCoreModuleRef();
  return providerRings([...container.getModules().values()].filter((module) => module !== core), keys, sourceOf);
}
