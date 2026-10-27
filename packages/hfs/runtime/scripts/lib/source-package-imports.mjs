// Source-package imports preserve published export and exact dependency contracts without a workspace install.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { insidePath, pathKey, realPath } from './path-key.mjs';

const packageNameOf = (specifier) => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

function conditionalTarget(value, conditions) {
  if (typeof value === 'string' || value === null) return value;
  if (Array.isArray(value)) return value.map(entry => conditionalTarget(entry, conditions)).find(entry => entry !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  for (const [condition, target] of Object.entries(value)) {
    if (condition === 'default' || conditions.includes(condition)) {
      const selected = conditionalTarget(target, conditions);
      if (selected !== undefined) return selected;
    }
  }
}

/** Resolve only exports that the package publishes; private paths remain unavailable in a source checkout. */
function exportedTarget(exports, subpath, conditions) {
  if (!exports || typeof exports !== 'object' || Array.isArray(exports)) return subpath === '.' ? conditionalTarget(exports, conditions) : undefined;
  const keys = Object.keys(exports);
  if (keys.every(key => !key.startsWith('.'))) return subpath === '.' ? conditionalTarget(exports, conditions) : undefined;
  if (Object.hasOwn(exports, subpath)) return conditionalTarget(exports[subpath], conditions);
  const patterns = keys.filter(key => key.includes('*')).sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);
  for (const pattern of patterns) {
    const [prefix, suffix] = pattern.split('*');
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const match = subpath.slice(prefix.length, suffix ? -suffix.length : undefined);
    const target = conditionalTarget(exports[pattern], conditions);
    return typeof target === 'string' ? target.replaceAll('*', match) : target;
  }
}

function sourcePackages(root, packages) {
  return Object.entries(packages).filter(([, pin]) => typeof pin?.source === 'string').map(([name, pin]) => {
    const manifestFile = realPath(path.resolve(root, pin.source));
    if (!insidePath(root, manifestFile, { key: pathKey })) throw new Error(`Source package ${name} is outside the source tree`);
    return { name, pin, manifestFile, root: path.dirname(manifestFile), manifest: null };
  }).sort((a, b) => b.root.length - a.root.length);
}

function manifestOf(source) {
  source.manifest ??= JSON.parse(fs.readFileSync(source.manifestFile, 'utf8'));
  if (source.manifest.name !== source.name || source.manifest.version !== source.pin.version) {
    throw new Error(`Source package ${source.name} does not match its pinned name and version`);
  }
  return source.manifest;
}

/** Settle each declared bare dependency before installing a hook, using the consumer first and source install second. */
function consumerDependencyTargets(sources, consumerRoot) {
  const consumer = createRequire(path.join(consumerRoot, 'package.json'));
  for (const source of sources) {
    const manifest = manifestOf(source), local = createRequire(source.manifestFile);
    source.consumerDependencies = new Map();
    for (const name of Object.keys({ ...manifest.peerDependencies, ...manifest.optionalDependencies, ...manifest.dependencies })) {
      for (const require of [consumer, local]) {
        try { source.consumerDependencies.set(name, pathToFileURL(require.resolve(name)).href); break; }
        catch { /* The next install may carry the dependency; a missing import still fails through the native resolver. */ }
      }
    }
  }
}

function resolveSource(specifier, context, nextResolve, sources, consumerRoot) {
  if (!context.parentURL?.startsWith('file:')) return nextResolve(specifier, context);
  const parent = fileURLToPath(context.parentURL);
  const owner = sources.find(source => insidePath(source.root, parent, { key: pathKey }));
  const target = sources.find(source => source.name === packageNameOf(specifier));
  if (!target) {
    const dependency = owner?.consumerDependencies?.get(specifier);
    return dependency ? { url: dependency, shortCircuit: true } : nextResolve(specifier, context);
  }
  if (!owner && (!consumerRoot || !insidePath(consumerRoot, parent, { key: pathKey }))) return nextResolve(specifier, context);
  const manifest = manifestOf(target);
  if (owner) {
    const caller = manifestOf(owner);
    const dependency = caller.dependencies?.[target.name] ?? caller.devDependencies?.[target.name] ?? caller.optionalDependencies?.[target.name];
    if (owner !== target && dependency !== manifest.version) throw new Error(`${owner.name} must declare its source dependency ${target.name}@${manifest.version} exactly`);
  }
  const subpath = `.${specifier.slice(target.name.length)}`;
  const published = exportedTarget(manifest.exports, subpath, context.conditions);
  if (typeof published !== 'string' || !published.startsWith('./')) throw new Error(`${specifier} is not a published source-package export`);
  const resolved = path.resolve(target.root, published);
  if (!insidePath(target.root, resolved, { key: pathKey }) || published.split('/').includes('node_modules')) throw new Error(`${specifier} has an invalid source-package export target`);
  return { url: pathToFileURL(resolved).href, shortCircuit: true };
}

/**
 * Await source imports with pinned local packages resolved through their own public exports.
 * Imports originating inside a declared source package obey exact dependency versions and public exports.
 * An explicit consumerRoot also redirects that consumer's selected source-package imports and resolves source
 * packages' declared bare imports and requires from the consumer install first. This keeps a parser and its
 * typed rules on the same dependency instances. The hook is removed on success or failure; callers await
 * every import and dependent action. Normal installed-package resolution remains in force afterward.
 * @param {{ root: string, packages: Record<string, { version: string, source?: string }>, consumerRoot?: string }} input - Canonical source pins and an optional bounded consumer source root.
 * @param {() => Promise<unknown>} action - Imports whose package contracts are being checked.
 * @returns {Promise<unknown>} The action's result, without a persistent resolver change.
 */
export async function withSourcePackageImports({ root, packages, consumerRoot }, action) {
  const sources = sourcePackages(realPath(root), packages);
  const consumer = consumerRoot === undefined ? null : realPath(consumerRoot);
  if (consumer) consumerDependencyTargets(sources, consumer);
  const hook = registerHooks({ resolve: (specifier, context, nextResolve) => resolveSource(specifier, context, nextResolve, sources, consumer) });
  try { return await action(); }
  finally { hook.deregister(); }
}
