// dev-services.mts - the upgrade `starci app sync` makes to an existing app's dev environment so it holds the dev services of the starter and their
// ports follow the role table of its base port (R389, PROJECT-STACKS-10, stack-base-port.mts). For every docker-compose environment that declares
// `local.basePort`:
//   - the database, `mail` and `mailui` ports move onto their compose slots (base+90, base+91, base+92) when the slot is free;
//   - an environment that runs no object store gains the `storage` service (the MinIO the starter pins): its two ports, the service the verbs start,
//     the least grant of the `storage` member's two keys (its root credentials), the api's STORAGE_ENDPOINT on the new port, a `storage-live`
//     readiness probe and the console origin, and the service and its volume in the first compose file.
// Nothing else of either file changes: the edits are line edits of the block YAML the starter writes, every other byte (comments, order, layout)
// kept. A shape the edits cannot place (a flow mapping, no custody of the `storage` member) is named as a notice and left to the owner.
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { isPlainObject as plain } from '../runtime/engine/plain-object.mjs';
import { COMPOSE_ROLES, composePort, type ComposeRole } from '../runtime/scripts/hfs/stack-base-port.mjs';
import type { DeclarationEdit } from './declared-sides.mjs';

const STACK_FILE = '.starcistacks/application-stacks.yaml';
const NAME = /^[a-z][a-z0-9-]*$/u;
/** The image the starter's `storage` service runs, the `minio` pin of contexts/stack/pins.yaml (dev-storage.spec.mts holds them equal). */
export const STORAGE_IMAGE = 'ghcr.io/starci183/minio:RELEASE.2025-10-15T17-29-55Z-starci.1@sha256:ec6dfba54eaa8e0d77bed9e7c6d86df90ad341f914ecfd3d613f0f811155f40f';
/** The repository of an object store a compose service already runs: the StarCi MinIO or the upstream one. */
const OBJECT_STORE = /(?:^|\/)minio(?::|@|$)/u;

/** The edits and the notices of the upgrade: what changes, and what the owner places by hand. */
export interface DevServicesUpgrade { edits: DeclarationEdit[]; notices: string[] }

type Lines = string[];
const indentOf = (line: string): number => /^ */u.exec(line)?.[0].length ?? 0;
const meaningful = (line: string): boolean => line.trim() !== '' && !line.trim().startsWith('#');

/** The lines [from, to) of the child `key:` of the block that starts after `start` and holds its children at `indent`; null when absent. */
function child(lines: Lines, start: number, end: number, indent: number, key: string): { at: number; end: number } | null {
  const pattern = new RegExp(`^ {${indent}}${key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}:(?:\\s|$)`, 'u');
  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? '';
    if (!pattern.test(line)) continue;
    let stop = index + 1;
    while (stop < end && (!meaningful(lines[stop] ?? '') || indentOf(lines[stop] ?? '') > indent)) stop += 1;
    while (stop > index + 1 && !meaningful(lines[stop - 1] ?? '')) stop -= 1;
    return { at: index, end: stop };
  }
  return null;
}

/** The index after the last line of a block list or mapping that opens at `block.at`, and the indent of its items; null when the block is a flow value. */
function blockTail(lines: Lines, block: { at: number; end: number }): { insertAt: number; indent: string } | null {
  if (/:\s*\S/u.test((lines[block.at] ?? '').replace(/#.*$/u, ''))) return null;
  const item = lines.slice(block.at + 1, block.end).find(meaningful);
  const indent = item === undefined ? ' '.repeat(indentOf(lines[block.at] ?? '') + 2) : ' '.repeat(indentOf(item));
  return { insertAt: block.end, indent };
}

/** The two keys of the `storage` member the custody creates: the access key id and the secret key. */
function storageKeys(local: Record<string, unknown>): { id: string; secret: string } | null {
  const keys = (Array.isArray(local.custody) ? local.custody : [])
    .filter((entry): entry is Record<string, unknown> => plain(entry) && entry.member === 'storage' && typeof entry.key === 'string')
    .map((entry) => String(entry.key));
  const secret = keys.find((key) => key.includes('SECRET'));
  const id = keys.find((key) => key !== secret);
  return secret !== undefined && id !== undefined ? { id, secret } : null;
}

/** The compose service of the starter's dev object store, as the lines of a block under `services:`. */
function storageService(keys: { id: string; secret: string }): string[] {
  return [
    '  storage:',
    `    image: ${STORAGE_IMAGE}`,
    '    command: ["server", "/data", "--console-address", ":9001"]',
    '    environment:',
    `      MINIO_ROOT_USER_FILE: /run/secrets/${keys.id}`,
    `      MINIO_ROOT_PASSWORD_FILE: /run/secrets/${keys.secret}`,
    '    ports:',
    '      - "127.0.0.1:${STACK_PORT_STORAGE}:9000"',
    '      - "127.0.0.1:${STACK_PORT_STORAGE_CONSOLE}:9001"',
    '    volumes:',
    '      - storage-data:/data',
    '      - ${STACK_GRANT_STORAGE}:/run/secrets:ro',
    '    healthcheck:',
    '      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:9000/minio/health/live"]',
    '      interval: 5s',
    '      timeout: 5s',
    '      retries: 20',
    '      start_period: 5s',
    '    restart: unless-stopped',
  ];
}

/** The compose text with the storage service before the first top-level key after `services:` and `storage-data` among its volumes. */
function composeWithStorage(text: string, keys: { id: string; secret: string }): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  const services = lines.findIndex((line) => /^services:\s*$/u.test(line));
  let after = lines.findIndex((line, index) => index > services && /^[A-Za-z]/u.test(line));
  if (after < 0) after = lines.length;
  while (after > services + 1 && !meaningful(lines[after - 1] ?? '')) after -= 1;
  lines.splice(after, 0, ...storageService(keys));
  const volumes = lines.findIndex((line) => /^volumes:\s*$/u.test(line));
  if (volumes < 0) lines.push('volumes:', '  storage-data: {}');
  else {
    let end = volumes + 1;
    while (end < lines.length && (!meaningful(lines[end] ?? '') || indentOf(lines[end] ?? '') > 0)) end += 1;
    while (end > volumes + 1 && !meaningful(lines[end - 1] ?? '')) end -= 1;
    lines.splice(end, 0, '  storage-data: {}');
  }
  return `${lines.join(newline)}${newline}`;
}

/** The compose service of the environment that already runs an object store (its image is MinIO), named with its image; null when none does. */
function runsObjectStore(envDir: string, files: readonly string[]): string | null {
  for (const relative of files) {
    let doc: unknown;
    try { doc = parseYaml(fs.readFileSync(path.join(envDir, relative), 'utf8')); } catch { continue; }
    const services = plain(doc) && plain(doc.services) ? doc.services : {};
    for (const [name, spec] of Object.entries(services)) if (plain(spec) && typeof spec.image === 'string' && OBJECT_STORE.test(spec.image.split('@')[0] ?? '')) return `the compose service ${name} (${spec.image.split('@')[0]})`;
  }
  return null;
}

/**
 * The upgrade of the dev environments of the app at `root`: the edits of the stack declaration and its compose files, and the notices of what was
 * left. `read(path)` gives a file's text as earlier edits of this sync leave it (the declared sides edit the same declaration first).
 */
export function devServicesUpgrade(root: string, read: (relative: string) => string | null = (relative) => { try { return fs.readFileSync(path.join(root, relative), 'utf8'); } catch { return null; } }): DevServicesUpgrade {
  const out: DevServicesUpgrade = { edits: [], notices: [] };
  const text = read(STACK_FILE);
  if (text === null) return out;
  let doc: unknown;
  try { doc = parseYaml(text); } catch { return out; }
  const environments = plain(doc) && plain(doc.environments) ? doc.environments : {};
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/u);
  const reasons: string[] = [];
  for (const [environment, spec] of Object.entries(environments)) {
    const top = child(lines, 0, lines.length, 0, 'environments');
    if (!NAME.test(environment) || !plain(spec) || spec.runtime !== 'docker-compose' || !plain(spec.local)) continue;
    const local = spec.local;
    const at = `${STACK_FILE} environments.${environment}.local`;
    if (!Number.isInteger(local.basePort)) { out.notices.push(`notice: ${at} declares no basePort: its compose ports are not derived and no dev service is added; declare the project base port, then run starci app sync --execute again (R389, PROJECT-STACKS-10)`); continue; }
    const base = local.basePort as number;
    const ports = plain(local.ports) ? local.ports : {};
    const envBlock = top && child(lines, top.at + 1, top.end, 2, environment);
    const localBlock = envBlock && child(lines, envBlock.at + 1, envBlock.end, 4, 'local');
    const portsBlock = localBlock && child(lines, localBlock.at + 1, localBlock.end, 6, 'ports');
    const portsTail = portsBlock && blockTail(lines, portsBlock);
    if (!localBlock || !portsBlock || !portsTail) { out.notices.push(`notice: ${at}.ports is not a block mapping the upgrade can edit: place the compose ports by the role table of PROJECT-STACKS-10 by hand`); continue; }
    const taken = (port: number, except: string): string | undefined => Object.entries(ports).find(([name, value]) => name !== except && value === port)?.[0];
    const database = plain(local.database) && typeof local.database.port === 'string' ? local.database.port : 'db';
    for (const [role, name] of [['db', database], ['mail', 'mail'], ['mailui', 'mailui']] as Array<[ComposeRole, string]>) {
      if (!Object.hasOwn(ports, name)) continue;
      const want = composePort(base, role);
      if (ports[name] === want) continue;
      const holder = taken(want, name);
      if (holder !== undefined) { out.notices.push(`notice: ${at}.ports.${name} stays ${String(ports[name])}: its slot ${want} (basePort + ${COMPOSE_ROLES[role]}) is the port of ${holder}`); continue; }
      const index = lines.findIndex((line, i) => i > portsBlock.at && i < portsBlock.end && new RegExp(`^ +${name}:\\s*${String(ports[name])}\\s*(?:#.*)?$`, 'u').test(line));
      if (index < 0) { out.notices.push(`notice: ${at}.ports.${name} is not a plain line the upgrade can edit: set it to ${want} by hand`); continue; }
      lines[index] = (lines[index] ?? '').replace(new RegExp(`(:\\s*)${String(ports[name])}`, 'u'), `$1${want}`);
      ports[name] = want;
      reasons.push(`${environment} ${name} ${want}`);
    }
    const files = (Array.isArray(spec.composeFiles) ? spec.composeFiles : []).filter((file): file is string => typeof file === 'string' && !path.isAbsolute(file) && !file.split(/[\\/]/u).includes('..'));
    const envDir = path.join(root, '.starcistacks', environment);
    if (Object.hasOwn(ports, 'storage')) continue;
    const store = runsObjectStore(envDir, files);
    if (store !== null) { out.notices.push(`notice: ${at} already runs an object store (${store}): no storage service is added`); continue; }
    const keys = storageKeys(local);
    if (keys === null) { out.notices.push(`notice: ${at}.custody declares no \`storage\` member with an access key and a secret key: the storage service is not added (its root credentials are that member's keys)`); continue; }
    const api = composePort(base, 'storage');
    const console = composePort(base, 'storage-console');
    const clash = taken(api, 'storage') ?? taken(console, 'storage-console');
    if (clash !== undefined) { out.notices.push(`notice: ${at}: the storage slots ${api} and ${console} hold ${clash}: the storage service is not added`); continue; }
    const composeFile = files[0];
    const compose = composeFile === undefined ? null : read(path.posix.join('.starcistacks', environment, composeFile.split(path.sep).join('/')));
    if (composeFile === undefined || compose === null || !/^services:\s*$/mu.test(compose)) { out.notices.push(`notice: ${at}: no compose file with a services block to add the storage service to`); continue; }
    const inserts: Array<{ at: number; lines: string[] }> = [{ at: portsTail.insertAt, lines: [`${portsTail.indent}storage: ${api}`, `${portsTail.indent}storage-console: ${console}`] }];
    const listItem = (key: string, item: string, fallback: boolean): void => {
      const block = child(lines, localBlock.at + 1, localBlock.end, 6, key);
      const tail = block && blockTail(lines, block);
      if (tail) inserts.push({ at: tail.insertAt, lines: [`${tail.indent}- ${item}`] });
      else if (!block && fallback) inserts.push({ at: localBlock.end, lines: [`      ${key}:`, `        - ${item}`] });
      else if (block) out.notices.push(`notice: ${at}.${key} is a flow value: add ${item} by hand`);
    };
    listItem('services', '{name: storage, wait: healthy}', true);
    listItem('grants', `{name: storage, keys: [${keys.id}, ${keys.secret}]}`, true);
    listItem('ready', '{name: storage-live, url: "http://localhost:${port.storage}/minio/health/live"}', false);
    listItem('origins', '{name: storage, url: "http://localhost:${port.storage-console}"}', false);
    for (let index = localBlock.at + 1; index < localBlock.end; index += 1) {
      const line = lines[index] ?? '';
      if (/^\s+STORAGE_ENDPOINT:\s*/u.test(line) && !line.includes('${port.storage}')) lines[index] = line.replace(/(STORAGE_ENDPOINT:\s*).*$/u, '$1"http://127.0.0.1:${port.storage}"');
    }
    for (const insert of inserts.sort((a, b) => b.at - a.at)) lines.splice(insert.at, 0, ...insert.lines);
    const composePath = path.posix.join('.starcistacks', environment, composeFile.split(path.sep).join('/'));
    out.edits.push({ path: composePath, reason: `the dev environment ${environment} gains the storage service, the object store the starter runs (PROJECT-STACKS-10)`, content: composeWithStorage(compose, keys) });
    reasons.push(`${environment} gains the storage service on storage ${api}, storage-console ${console}`);
  }
  if (reasons.length > 0) out.edits.unshift({ path: STACK_FILE, reason: `the dev ports follow the role table of the base port (R389): ${reasons.join('; ')}`, content: lines.join(newline) });
  return out;
}
