// canon-pins.mjs - where the canon pins live and how they are read: knowledge/hfs/canon-pins.yaml (shape:
// modules/schemas/canon-pins.schema.yaml) and the profiles bound to the canons, modules/models/code-patterns.yaml.
// The gates read the pins here; scripts/checks/check-canon-pins.mjs is the self-check that judges them.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { skillRoot } from '../../engine/runtime-root.mjs';
import { parseYaml } from '../../engine/yaml.mjs';
import { grammarLintFor } from '../lib/grammar-lint.mjs';
import { locateDeclaration } from '../hfs/slots.mjs';
import { pathKey, posixPath } from '../lib/path-key.mjs';
import { canonContentDigest, installedFiles } from './canon-digest.mjs';

export const PINS_FILE = 'knowledge/hfs/canon-pins.yaml';
export const SCHEMA_FILE = 'modules/schemas/canon-pins.schema.yaml';
export const PROFILES_FILE = 'modules/models/code-patterns.yaml';
/** A missing, mismatched or unjudged installed canon remains a failing gate. */
export const CANON_INSTALL_CODES = Object.freeze({ missing: 'CANON_INSTALL_MISSING', mismatch: 'CANON_INSTALL_MISMATCH', unjudged: 'CANON_INSTALL_UNJUDGED' });

/** The parsed canon pins of the runtime at `root`. */
export function loadPins(root = skillRoot) {
  return parseYaml(fs.readFileSync(path.join(root, PINS_FILE), 'utf8'));
}

/** Every independently published canon binding of a profile, including each declared Grammar family. */
export function profileCanonBindings(profile) {
  return [
    { binding: 'canon', canon: profile?.canon },
    ...Object.entries(profile?.familyCanons ?? {}).map(([family, canon]) => ({ binding: `familyCanons.${family}`, family, canon })),
  ];
}

/** The zero-based source lines that author actual profile canon versions, including named family bindings. */
export function canonBindingVersionLines(text) {
  const profiles = parseYaml(text)?.profiles ?? {};
  const bindings = new Map(Object.entries(profiles).flatMap(([profile, value]) => profileCanonBindings(value)
    .filter(row => typeof row.canon?.package === 'string' && typeof row.canon?.version === 'string')
    .map(row => [JSON.stringify(['profiles', profile, ...row.binding.split('.')]), row.canon])));
  const leaves = new Map(), stack = [];
  text.split('\n').forEach((line, index) => {
    const separator = line.indexOf(':'), field = line.slice(0, separator), key = field.trim();
    if (separator < 0 || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) return;
    const indent = field.length - field.trimStart().length, value = line.slice(separator + 1).trimStart();
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const keys = [...stack.map(entry => entry.key), key];
    let binding = bindings.get(JSON.stringify(keys));
    if (key === 'version') binding = bindings.get(JSON.stringify(keys.slice(0, -1)));
    if (binding && (key === 'version' || /^\{.*\bversion\s*:/.test(value))) leaves.set(index, { package: binding.package, version: binding.version });
    stack.push({ key, indent });
  });
  return leaves;
}

/** The universal binding and the explicitly selected family's binding; no absent selection implies a family. */
export function selectedProfileCanonBindings(profile, family) {
  const bindings = [{ binding: 'canon', canon: profile?.canon }];
  if (!profile?.familyCanons) return bindings;
  const contract = grammarLintFor(family);
  if (contract.package === null) return bindings;
  const canon = profile.familyCanons[contract.family];
  if (!canon || canon.package !== contract.package) {
    throw new Error(`Grammar family ${contract.family} has no matching code-pattern canon binding for ${contract.package}`);
  }
  return [...bindings, { binding: `familyCanons.${contract.family}`, family: contract.family, canon }];
}

/** The package root resolved from a side's npm install, without admitting an install above the app boundary. */
function installedPackageRoot(directory, name, bound) {
  const top = pathKey(bound);
  const searched = (createRequire(path.join(directory, 'package.json')).resolve.paths(name) ?? []).filter(modules => pathKey(modules).startsWith(`${top}/`));
  for (const modules of searched) {
    const candidate = path.join(modules, ...name.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
  }
  return null;
}

/** Inspect one selected binding's actual installed bytes; errors remain unavailable and mismatches remain findings. */
function inspectBinding(root, bound, pins, profile, row, out) {
  const { canon, family } = row, side = pins[canon?.package]?.side;
  const label = row.binding === 'canon' ? profile : `${profile}.${row.binding}`;
  if (!canon?.package || typeof side !== 'string') { out.errors.push(`${CANON_INSTALL_CODES.unjudged} profile ${label}: canon.package ${canon?.package} has no pinned side`); return; }
  const installed = installedPackageRoot(path.join(root, side), canon.package, bound);
  if (!installed) { out.errors.push(`${CANON_INSTALL_CODES.missing} profile ${label}: ${canon.package} does not resolve from ${side}/ of the app; install the pinned ${canon.version}`); return; }
  const where = posixPath(path.relative(root, installed));
  let manifest, version, digest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
    version = manifest.version ?? null;
    digest = canonContentDigest(installed, canon.contentDigest, installedFiles(installed));
  } catch (error) { out.errors.push(`${CANON_INSTALL_CODES.unjudged} profile ${label}: ${error.code ?? 'ERROR'} ${error.message}`); return; }
  out.checked.push({ profile: label, ...(family ? { family } : {}), package: canon.package, side, path: where, version, digest: digest.value, files: digest.files });
  if (version !== canon.version || digest.value !== canon.contentDigest.value || digest.files !== canon.contentDigest.files) {
    out.findings.push({ engine: 'canon', rule: 'installed-canon-mismatch', path: where, line: null,
      message: `${canon.package} installed for ${side}/ is ${version} with ${digest.files} files digesting ${digest.value}; profile ${label} binds ${canon.version} with ${canon.contentDigest.files} files digesting ${canon.contentDigest.value} (${CANON_INSTALL_CODES.mismatch}: reinstall the pinned version from the registry)` });
  }
  return Object.keys(manifest.dependencies ?? {});
}

/** Judge the universal and explicitly selected family installs against their independent version/content bindings. */
export function inspectInstalledCanons(root, { pins, profiles, bound = root }) {
  const out = { checked: [], findings: [], errors: [] };
  for (const [profile, value] of Object.entries(profiles)) {
    let bindings;
    try {
      const declaration = value?.familyCanons ? JSON.parse(fs.readFileSync(locateDeclaration(root).file, 'utf8')) : null;
      bindings = selectedProfileCanonBindings(value, declaration?.sides?.fe?.grammar);
    } catch (error) { out.errors.push(`${CANON_INSTALL_CODES.unjudged} profile ${profile}: ${error.message}`); continue; }
    const available = profileCanonBindings(value), checked = new Set();
    for (const row of bindings) {
      if (checked.has(row.canon?.package)) continue;
      checked.add(row.canon?.package);
      const dependencies = inspectBinding(root, bound, pins, profile, row, out) ?? [];
      // A family adapter's digest does not cover its independently published implementation dependency.
      bindings.push(...available.filter(entry => dependencies.includes(entry.canon?.package) && !checked.has(entry.canon.package)));
    }
  }
  return out;
}
