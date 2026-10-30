// Names-only declarations become genuine sealed placeholders when an app or example is materialized.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseYaml } from '../../engine/yaml.mjs';
import { byCodeUnit } from '../lib/list.mjs';
import { setSecretValues } from './secret-store.mjs';
import { memberFile } from '../lib/sealed-member.mjs';
import { sealBootstrapValues } from './secret-bootstrap-crypto.mjs';
import type { SecretSops } from './secret-sops.mjs';

/** A sealed member a declaration names: the environment, the file slug and the environment keys it holds. */
export interface SealedMember {
  env: string;
  slug: string;
  keys: string[];
}

// reason: a declaration is parsed YAML/JSON from disk (a slug string, or {where | name, keys?})
type ParsedDocument = any;

const ENVIRONMENT = /^[a-z0-9][a-z0-9-]*$/u;
const MEMBER = /^secrets\/([a-z0-9][a-z0-9-]*)(?:\.enc(?:\.yaml)?)?$/u;
const KEY = /^[A-Z][A-Z0-9_]*$/u;

function readDocument(file: string, format: 'json' | 'yaml'): ParsedDocument {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  return format === 'json' ? JSON.parse(text) : parseYaml(text);
}

function memberOf(environment: string, declaration: ParsedDocument): SealedMember {
  const entry = typeof declaration === 'string' ? { where: declaration } : declaration;
  const location = entry?.where ?? (entry?.name && `secrets/${entry.name}`);
  const match = MEMBER.exec(location ?? '');
  if (!ENVIRONMENT.test(environment) || !match)
    throw new Error('sealed member declarations must use .starcistacks/<environment>/secrets/<slug>');
  return { env: environment, slug: match[1] as string, keys: entry.keys };
}

function rosterKeys(repoRoot: string, member: { env: string; slug: string }): string[] {
  const file = path.join(repoRoot, '.starcistacks', member.env, 'runtime', 'env', 'KEYS.md');
  if (!fs.existsSync(file)) return [];
  const keys: string[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const key = /^|s*`|\s*`([A-Z][A-Z0-9_]*)`\s*\|/u.exec(line)?.[1];
    if (!key) continue;
    const locations = [...line.matchAll(/(?:secrets\/|\/run\/secrets\/)([a-z0-9][a-z0-9-]*)(?:\.enc(?:\.yaml)?)?/gu)];
    if (locations.some((match) => match[1] === member.slug)) keys.push(key);
  }
  return keys;
}

function keysOf(repoRoot: string, member: { env: string; slug: string; keys?: unknown }): string[] {
  const declared = Array.isArray(member.keys) ? member.keys : rosterKeys(repoRoot, member);
  const keys = declared.length ? declared : [member.slug.replaceAll('-', '_').toUpperCase()];
  if (keys.some((key) => !KEY.test(key))) throw new Error('sealed member keys must be environment key names');
  return [...new Set(keys)].sort(byCodeUnit);
}

function descriptorMembers(repoRoot: string): SealedMember[] {
  const stacks = path.join(repoRoot, '.starcistacks');
  const members: SealedMember[] = [];
  if (!fs.existsSync(stacks)) return [];
  for (const entry of fs.readdirSync(stacks, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ENVIRONMENT.test(entry.name)) continue;
    const descriptor = readDocument(path.join(stacks, entry.name, 'environment.json'), 'json');
    for (const declaration of descriptor.secrets ?? []) members.push(memberOf(entry.name, declaration));
  }
  return members;
}

/** Resolve public member/key names without opening any existing envelope or private identity. */
export function declaredSealedMembers(repoRoot: string): SealedMember[] {
  const manifest = readDocument(path.join(repoRoot, '.starcistacks', 'application-stacks.yaml'), 'yaml');
  const declarations = descriptorMembers(repoRoot);
  for (const [environment, model] of Object.entries(manifest?.environments ?? {}) as Array<[string, ParsedDocument]>) {
    for (const declaration of model?.secrets ?? []) declarations.push(memberOf(environment, declaration));
  }
  const members = new Map<string, SealedMember>();
  for (const member of declarations) {
    const id = `${member.env}/${member.slug}`;
    members.set(id, { ...member, keys: keysOf(repoRoot, member) });
  }
  return [...members.values()].sort((left, right) => `${left.env}/${left.slug}`.localeCompare(`${right.env}/${right.slug}`));
}

/** How the missing members are sealed: the app public age recipient(s), the sops adapter (absent: the sops-free bootstrap sealer) and the selector of members. */
export interface PlaceholderOptions {
  recipient?: string | undefined;
  recipientsForFile?: ((file: string) => string[]) | undefined;
  processEnv?: NodeJS.ProcessEnv | undefined;
  sops?: Pick<SecretSops, 'seal'> | undefined;
  write?: ((file: string, sealed: string) => void) | undefined;
  only?: ((member: SealedMember) => boolean) | undefined;
}

function placeholderValue(key: string): string {
  const generated = randomUUID();
  if (key.endsWith('_URL') && key.slice(0, -4).endsWith('DB')) return `postgresql://app_be:${generated}@db.invalid:5432/app`;
  if (key.endsWith('_URL')) return `https://example.invalid/${generated}`;
  return generated;
}

/** Create missing members (those `only` selects) for this app's recipient, preserving owner-provisioned members. */
export function materializeDeclaredPlaceholders(repoRoot: string, { recipient, recipientsForFile, processEnv = process.env, sops, write, only = () => true }: PlaceholderOptions = {}): { members: string[] } {
  const members: string[] = [];
  for (const member of declaredSealedMembers(repoRoot).filter((declared) => only(declared))) {
    const directory = path.join(repoRoot, '.starcistacks', member.env, 'secrets');
    if (fs.existsSync(memberFile(directory, member.slug))) continue;
    // The sops-free bootstrap sealer writes dotenv only, so its placeholder is a legacy `.enc` until `migrate` moves it.
    const file = sops ? memberFile(directory, member.slug) : path.join(directory, `${member.slug}.enc`);
    const relative = path.relative(repoRoot, file).split(path.sep).join('/');
    const age = (recipientsForFile?.(file) ?? [recipient]) as string[];
    if (!age.length || age.some((value) => !/^age1[a-z0-9]+$/u.test(value ?? '')))
      throw new Error('sealed placeholders require the app public age recipient');
    if (!sops && age.length !== 1) throw new Error('multiple recipients require the standard SOPS adapter');
    const values = Object.fromEntries(member.keys.map((key) => [key, placeholderValue(key)]));
    const adapter = (sops ?? { seal: () => sealBootstrapValues({ values, recipient: age[0] as string }) }) as unknown as SecretSops;
    setSecretValues(repoRoot, { slug: member.slug, values, env: member.env }, {
      age, processEnv, sops: adapter, write, legacy: !sops,
    });
    members.push(relative);
  }
  return { members };
}
