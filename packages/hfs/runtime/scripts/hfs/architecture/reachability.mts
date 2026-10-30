/**
 * HFS check 3, reachability (knowledge/hfs/slots.yaml rules BE_FEATURE_NOT_COMPOSED, FE_OWNER_REACHABLE):
 *   BE  every feature owner (be.feature) and every capability owner (be.domain, be.integrations, be.platform) must be
 *       composed into an app root: reachable from an app entry file (apps/<app>/src, the be.app.* owners) through runtime
 *       imports and re-exports. A type-only import composes nothing. A module reached only through a reached module
 *       is reached. An owner no root reaches is dead code: no process ever serves it.
 *   FE  every page/layout/overlay feature (fe.feature) must be mounted: reachable by runtime imports from a file of
 *       its app's route tree (apps/<app>/src/app, slot fe.route); and every string-literal href/redirect/router target
 *       must resolve to a route of that app (page.tsx / route.ts under src/app, route groups and [locale] transparent).
 * Only literals are judged: a computed href is counted as skipped, never guessed at.
 */
import type { Expression, Node, SourceFile } from 'typescript';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation, GraphFile, HfsGraph } from './hfs-graph.mjs';
import { byCodeUnit } from '../../lib/list.mjs';

export const REACHABILITY_RULE_IDS = ['BE_FEATURE_NOT_COMPOSED', 'FE_OWNER_REACHABLE', 'FE_HREF_RESOLVES'];

const BE_CAPABILITY_SLOTS = new Set(['be.domain', 'be.integrations', 'be.platform', 'be.platform.logging']);
const TEST_FILE = /(?:\.(?:spec|test|stories|e2e-spec)\.[cm]?[jt]sx?$)|(?:(?:^|\/)__tests__\/)/;
const ROUTE_FILE = /^(?:page|route)\.(?:tsx|ts|jsx|js)$/;
const PLACEHOLDER = '\u0000';
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const ESCAPE_MATCH = String.raw`\$&`;

/** One URL segment of a route: its kind and its spelling. */
interface RouteSegment {
  kind: 'static' | 'dyn' | 'catch' | 'optcatch';
  text: string;
}

/** An href-like target: the node to report on and its literal text (null = computed). */
interface HrefTarget {
  node: Node;
  text: string | null;
}

/** What a reachability check returns. */
export interface ReachabilityResult {
  violations: ArchitectureViolation[];
  coverage: { status: string; reason?: string; [counter: string]: unknown };
}

/** The counters of the back-end check. */
interface BackendCounts {
  features: number;
  modules: number;
  appRoots: number;
  notComposed: number;
}

/** The counters of the front-end check. */
interface FrontendCounts {
  pages: number;
  mounted: number;
  hrefs: number;
  hrefsResolved: number;
  hrefsSkipped: number;
  routes: number;
}

/** The checker context the front-end check reads the compiler API from. */
interface ReachabilityContext {
  ts?: TypeScriptApi;
  loaded?: { ts: TypeScriptApi };
}

/** Breadth-first reach over runtime, non-type-only edges (re-exports included) from `roots`. */
function reachFrom(graph: HfsGraph, roots: Iterable<string>): Set<string> {
  const forward = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!edge.runtime) continue;
    if (!forward.has(edge.from)) forward.set(edge.from, []);
    forward.get(edge.from)?.push(edge.to);
  }
  const reached = new Set(roots);
  const queue = [...roots];
  while (queue.length) {
    for (const next of forward.get(queue.shift() as string) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

function ownerFiles(graph: HfsGraph): Map<string, string[]> {
  const byUnit = new Map<string, string[]>();
  for (const [rel, node] of graph.files) {
    if (!node.owner) continue;
    const key = `${node.owner.slot}:${node.owner.root}`;
    if (!byUnit.has(key)) byUnit.set(key, []);
    byUnit.get(key)?.push(rel);
  }
  return byUnit;
}

/** The file that stands for an owner in a finding: its public entry when the graph holds one, else its first file. */
function entryOf(root: string, files: string[]): string {
  const base = root.replace(/\/$/, '');
  const entry = new RegExp(String.raw`^${base.replace(REGEX_SPECIALS, ESCAPE_MATCH)}/index\.[tj]sx?$`);
  return files.find(rel => entry.test(rel)) ?? [...files].sort(byCodeUnit)[0] as string;
}

function backendAppRoots(byUnit: Map<string, string[]>): { rootFiles: string[]; roots: string[] } {
  const rootFiles: string[] = [];
  const appRoots = new Set<string>();
  for (const [key, files] of byUnit) {
    const slot = key.slice(0, key.indexOf(':'));
    if (!slot.startsWith('be.app.')) continue;
    appRoots.add(key.slice(key.indexOf(':') + 1));
    for (const rel of files) if (!TEST_FILE.test(rel)) rootFiles.push(rel);
  }
  return { rootFiles, roots: [...appRoots].sort(byCodeUnit) };
}

function reportUncomposedBackendOwners(byUnit: Map<string, string[]>, reached: Set<string>, roots: string[], counts: BackendCounts, violations: ArchitectureViolation[]): void {
  for (const [key, files] of [...byUnit].sort(([a], [b]) => a.localeCompare(b))) {
    const slot = key.slice(0, key.indexOf(':'));
    const root = key.slice(key.indexOf(':') + 1);
    const feature = slot === 'be.feature';
    if (!feature && !BE_CAPABILITY_SLOTS.has(slot)) continue;
    counts[feature ? 'features' : 'modules'] += 1;
    if (files.some(rel => reached.has(rel))) continue;
    counts.notComposed += 1;
    const label = root.replace(/\/$/, '');
    violations.push({
      ruleId: 'BE_FEATURE_NOT_COMPOSED',
      path: entryOf(root, files), owner: label, slot, appRoots: roots,
      message: `${feature ? 'Feature' : 'Module'} ${label} is not composed into any app: no runtime import path leads from ${roots.join(', ')} to it (a type-only import composes nothing), so it is dead code that no process serves.`,
    });
  }
}

function checkBackend(graph: HfsGraph): ReachabilityResult {
  const byUnit = ownerFiles(graph);
  const { rootFiles, roots } = backendAppRoots(byUnit);
  const counts = { features: 0, modules: 0, appRoots: roots.length, notComposed: 0 };
  if (!roots.length) return { violations: [], coverage: { status: 'unavailable', reason: 'no be.app.* owner instance holds a source file, so there is no app root to compose into', ...counts } };
  const reached = reachFrom(graph, rootFiles);
  const violations: ArchitectureViolation[] = [];
  reportUncomposedBackendOwners(byUnit, reached, roots, counts, violations);
  reportUncomposedTransports(graph, reached, roots, counts, violations);
  return { violations, coverage: { status: 'checked', ...counts } };
}

/** A reached feature does not compose its other transport modules. Judge each module's runtime path. */
function reportUncomposedTransports(graph: HfsGraph, reached: Set<string>, roots: string[], counts: BackendCounts, violations: ArchitectureViolation[]): void {
  for (const [rel, node] of graph.files) {
    if (!node.owner || !rel.startsWith('src/features/') || TEST_FILE.test(rel)) continue;
    if (!/\/transport\/[^/]+\/[^/]+\.module\.[cm]?[jt]sx?$/.test(rel) || reached.has(rel)) continue;
    counts.notComposed += 1;
    violations.push({
      ruleId: 'BE_FEATURE_NOT_COMPOSED', path: rel, owner: node.owner.root, slot: node.slot, appRoots: roots,
      message: `Transport module ${rel} is not composed into any app: no runtime import path leads from ${roots.join(', ')} to it (a type-only import composes nothing).`,
    });
  }
}

/** Route table of one app: arrays of segments, each {kind:'static'|'dyn'|'catch'|'optcatch', text}. */
function routeSegmentsOf(parts: string[]): string[] | null {
  const segments: string[] = [];
  let usable = true;
  for (const part of parts) {
    if (/^\([^.)][^)]*\)$/.test(part)) continue;            // route group
    if (part.startsWith('@')) continue;                      // parallel slot: no URL segment
    if (part.startsWith('_') || /^\(\.+\)/.test(part)) { usable = false; break; } // private folder, intercepting route
    segments.push(part);
  }
  if (!usable) return null;
  if (segments[0] === '[locale]') segments.shift();
  return segments;
}

function routeSegmentOf(part: string): RouteSegment {
  if (/^\[\[\.\.\..+\]\]$/.test(part)) return { kind: 'optcatch', text: part };
  if (/^\[\.\.\..+\]$/.test(part)) return { kind: 'catch', text: part };
  if (/^\[.+\]$/.test(part)) return { kind: 'dyn', text: part };
  return { kind: 'static', text: part };
}

function routeTable(graph: HfsGraph, app: string): RouteSegment[][] {
  const prefix = `apps/${app}/src/app/`;
  const routes: RouteSegment[][] = [];
  for (const rel of graph.files.keys()) {
    if (!rel.startsWith(prefix)) continue;
    const parts = rel.slice(prefix.length).split('/');
    if (!ROUTE_FILE.test(parts.at(-1) as string)) continue;
    const segments = routeSegmentsOf(parts.slice(0, -1));
    if (segments === null) continue;
    routes.push(segments.map(routeSegmentOf));
  }
  return routes;
}

/** One href segment (may contain PLACEHOLDER for a template expression) against one route segment. */
function segmentMatches(hrefSegment: string, routeSegment: RouteSegment): boolean {
  if (!hrefSegment.includes(PLACEHOLDER)) return routeSegment.kind === 'dyn' || routeSegment.text === hrefSegment;
  if (routeSegment.kind === 'dyn' || routeSegment.kind === 'catch' || routeSegment.kind === 'optcatch') return true;
  const parts = hrefSegment.split(PLACEHOLDER).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
  return new RegExp(`^${parts.join('.*')}$`).test(routeSegment.text);
}

function matchRoute(hrefSegments: string[], route: RouteSegment[], at = 0, from = 0): boolean {
  if (from === route.length) return at === hrefSegments.length;
  const routeSegment = route[from] as RouteSegment;
  if (routeSegment.kind === 'optcatch' && matchRoute(hrefSegments, route, at, from + 1)) return true;
  if (routeSegment.kind === 'catch' || routeSegment.kind === 'optcatch') {
    for (let take = 1; at + take <= hrefSegments.length; take += 1) if (matchRoute(hrefSegments, route, at + take, from + 1)) return true;
    return false;
  }
  if (at >= hrefSegments.length || !segmentMatches(hrefSegments[at] as string, routeSegment)) return false;
  return matchRoute(hrefSegments, route, at + 1, from + 1);
}

function hrefResolves(href: string, routes: RouteSegment[][]): boolean {
  const cut = href.search(/[?#]/);
  const pathOnly = cut === -1 ? href : href.slice(0, cut);
  const segments = pathOnly.split('/').slice(1).filter(segment => segment !== '');
  const candidates = [segments];
  // A leading locale (a literal `en`/`vi-VN` or a bare template expression) is what [locale] carries: try without it too.
  if (segments.length && (/^[a-z]{2}(?:-[a-zA-Z]{2})?$/.test(segments[0] as string) || segments[0] === PLACEHOLDER)) candidates.push(segments.slice(1));
  return candidates.some(candidate => routes.some(route => matchRoute(candidate, route)));
}

/** The text of a string-ish expression with PLACEHOLDER for each ${...}; null when it is not a literal we can read. */
function literalText(ts: TypeScriptApi, node: Node | null | undefined): string | null {
  if (!node) return null;
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression?.(node)) node = node.expression;
  if (ts.isStringLiteralLike(node)) return node.text;                 // includes NoSubstitutionTemplateLiteral
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(span => PLACEHOLDER + span.literal.text).join('');
  return null;
}

const NAVIGATION_CALLS = new Set(['redirect', 'permanentRedirect']);
const ROUTER_METHODS = new Set(['push', 'replace', 'prefetch']);

/** Every href-like target in a source file: {node, text|null (null = computed)}. */
function jsxHrefTarget(ts: TypeScriptApi, node: Node): HrefTarget | null {
  if (!ts.isJsxAttribute(node) || !ts.isIdentifier(node.name) || node.name.text !== 'href' || !node.initializer) return null;
  const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
  return { node: value ?? node, text: value ? literalText(ts, value) : null };
}

function routerNameOf(ts: TypeScriptApi, callee: Expression): string {
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) return callee.expression.text;
  if (ts.isPropertyAccessExpression(callee) && ts.isPropertyAccessExpression(callee.expression)) return callee.expression.name.text;
  return '';
}

function isNavigationTarget(ts: TypeScriptApi, callee: Expression): boolean {
  const routerName = routerNameOf(ts, callee);
  return (ts.isIdentifier(callee) && NAVIGATION_CALLS.has(callee.text))
    || (ts.isPropertyAccessExpression(callee) && ROUTER_METHODS.has(callee.name.text) && /router$/i.test(routerName));
}

function callHrefTarget(ts: TypeScriptApi, node: Node): HrefTarget | null {
  if (!ts.isCallExpression(node) || !node.arguments.length) return null;
  const callee = node.expression;
  if (!isNavigationTarget(ts, callee)) return null;
  return { node: node.arguments[0] as Expression, text: literalText(ts, node.arguments[0]) };
}

function hrefTargetOf(ts: TypeScriptApi, node: Node): HrefTarget | null {
  return jsxHrefTarget(ts, node) ?? callHrefTarget(ts, node);
}

function hrefTargets(ts: TypeScriptApi, sourceFile: SourceFile): HrefTarget[] {
  const found: HrefTarget[] = [];
  const visit = (node: Node): void => {
    const target = hrefTargetOf(ts, node);
    if (target) found.push(target);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function appRouteRoots(graph: HfsGraph): Map<string, string[]> {
  const apps = new Map<string, string[]>();
  for (const [rel, node] of graph.files) {
    if (node.slot !== 'fe.route') continue;
    const app = /^apps\/([^/]+)\/src\/app\//.exec(rel)?.[1];
    if (!app) continue;
    if (!apps.has(app)) apps.set(app, []);
    apps.get(app)?.push(rel);
  }
  return apps;
}

function reportUnreachableFrontendFeatures(byUnit: Map<string, string[]>, reachedByApp: Map<string, Set<string>>, counts: FrontendCounts, violations: ArchitectureViolation[]): void {
  for (const [key, files] of [...byUnit].sort(([a], [b]) => a.localeCompare(b))) {
    if (!key.startsWith('fe.feature:')) continue;
    const root = key.slice('fe.feature:'.length);
    const app = /^apps\/([^/]+)\//.exec(root)?.[1];
    counts.pages += 1;
    const reached = reachedByApp.get(app as string);
    if (reached && files.some(rel => reached.has(rel))) { counts.mounted += 1; continue; }
    const label = root.replace(/\/$/, '');
    violations.push({
      ruleId: 'FE_OWNER_REACHABLE', path: entryOf(root, files), owner: label, app,
      message: `${label} is not mounted: no runtime import path leads from a route file under apps/${app}/src/app to it (a type-only import mounts nothing), so the page is never shown.`,
    });
  }
}

function routeApps(graph: HfsGraph, apps: Map<string, string[]>): string[] {
  return [...new Set([...apps.keys(), ...[...graph.files.keys()].map(rel => /^apps\/([^/]+)\/src\//.exec(rel)?.[1]).filter((app): app is string => Boolean(app))])].sort(byCodeUnit);
}

function hrefNeedsSkipping(text: string | null, routes: RouteSegment[][]): boolean {
  if (text === null || !text.startsWith('/') || text.startsWith('//') || !routes.length) return true;
  const hrefPath = text.split(/[?#]/)[0];
  return /\.[A-Za-z0-9]{1,6}$/.test((hrefPath as string).split('/').at(-1) as string); // static asset
}

function reportUnresolvedHref(app: string, rel: string, node: GraphFile, target: HrefTarget, prefix: string, violations: ArchitectureViolation[]): void {
  const point = node.sourceFile.getLineAndCharacterOfPosition(target.node.getStart(node.sourceFile));
  const shown = (target.text as string).split(PLACEHOLDER).join('${…}');
  violations.push({
    ruleId: 'FE_HREF_RESOLVES', path: rel, line: point.line + 1, column: point.character + 1, app, href: shown,
    message: `href "${shown}" matches no route of app ${app}: no page.tsx or route.ts under ${prefix}app serves that path.`,
  });
}

function inspectAppHrefTargets(app: string, graph: HfsGraph, ts: TypeScriptApi, routes: RouteSegment[][], counts: FrontendCounts, violations: ArchitectureViolation[]): void {
  const prefix = `apps/${app}/src/`;
  for (const [rel, node] of graph.files) {
    if (!rel.startsWith(prefix) || TEST_FILE.test(rel)) continue;
    for (const target of hrefTargets(ts, node.sourceFile)) {
      counts.hrefs += 1;
      if (hrefNeedsSkipping(target.text, routes)) { counts.hrefsSkipped += 1; continue; }
      if (hrefResolves(target.text as string, routes)) { counts.hrefsResolved += 1; continue; }
      reportUnresolvedHref(app, rel, node, target, prefix, violations);
    }
  }
}

function checkFrontend(_config: ArchitectureConfig | undefined, context: ReachabilityContext, graph: HfsGraph): ReachabilityResult {
  const ts = context.ts ?? (context.loaded as { ts: TypeScriptApi }).ts;
  const byUnit = ownerFiles(graph);
  const apps = appRouteRoots(graph);
  const counts: FrontendCounts = { pages: 0, mounted: 0, hrefs: 0, hrefsResolved: 0, hrefsSkipped: 0, routes: 0 };
  const violations: ArchitectureViolation[] = [];
  const reachedByApp = new Map<string, Set<string>>([...apps].map(([app, roots]) => [app, reachFrom(graph, roots)]));
  reportUnreachableFrontendFeatures(byUnit, reachedByApp, counts, violations);
  for (const app of routeApps(graph, apps)) {
    const routes = routeTable(graph, app);
    counts.routes += routes.length;
    inspectAppHrefTargets(app, graph, ts, routes, counts, violations);
  }
  return { violations, coverage: { status: 'checked', ...counts } };
}

export function checkReachability({ config, context, graph }: { config?: ArchitectureConfig; context: ReachabilityContext; graph: HfsGraph }): ReachabilityResult {
  return graph.profile === 'be' ? checkBackend(graph) : checkFrontend(config, context, graph);
}
