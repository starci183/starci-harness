// seeds.mjs - R375, the seed data of an app (contexts/project/stacks.md PROJECT-STACKS-12). It lives in two levels of `.starcistacks/`, the
// shared `seeds/` and `<env>/seeds/` of an environment the stack declaration names, each a manifest (`seeds.yaml`, stack-seeds-config.mjs) and
// the folders `sql/`, `data/` and `files/`:
//   HFS_SEEDS_SHAPE       a seed file outside those folders, a level of an undeclared environment, custody (a sealed member, a key) in a level;
//   HFS_SEED_MANIFEST     a manifest that is missing, does not parse or names a path that is not there, a file no entry covers, an after cycle;
//   HFS_SEED_DDL          a statement of a sql entry that changes the schema or its grants (seed data is never a migration);
//   HFS_SEED_DATA_SCHEMA  a data document that does not validate against the JSON schema its entry names;
//   HFS_SEED_TEST_DATA    a test marker (an example.test identity, a uat- or test- prefix) in a level a production environment applies: the
//                         shared level and the level of every environment that is not docker-compose.
// A plaintext secret on any seed line is R06's and a real identity R259's (HFS_SEED_PII). A finding names the file and line, never a value.
import path from 'node:path';
import { parseYaml } from '../../../engine/yaml.mjs';
import { validateAgainstSchema } from '../../lib/json-schema.mjs';
import { findStackDeclaration } from '../../lib/stack-declaration.mjs';
import { databaseExecutableTokens, databaseSqlStatements, databaseSqlTokens } from './database-migrations.mjs';
import { entryFiles, readSeedLevel, SEEDS_DIR, SEEDS_KEEP, SEEDS_MANIFEST } from '../stack-seeds-config.mjs';
import type { SeedEntry, SeedLevel } from '../stack-seeds-config.mjs';
import { found, readText } from './read.mjs';
import type { Finding, Parsed } from './rule-types.mjs';

export const HFS_SEEDS_SHAPE = 'HFS_SEEDS_SHAPE';
export const HFS_SEED_MANIFEST = 'HFS_SEED_MANIFEST';
export const HFS_SEED_DDL = 'HFS_SEED_DDL';
export const HFS_SEED_DATA_SCHEMA = 'HFS_SEED_DATA_SCHEMA';
export const HFS_SEED_TEST_DATA = 'HFS_SEED_TEST_DATA';

/** A seed file: `.starcistacks/seeds/<rest>` or `.starcistacks/<env>/seeds/<rest>`, captured as [level folder, rest]. */
const SEED_PATH = /^(\.starcistacks\/(?:[^/]+\/)?seeds)\/(.+)$/u;
/** Where a file of a level may sit: the manifest, or under one of the kind folders. */
const LEVEL_FILE = /^(?:seeds\.yaml|(?:sql|data|files)\/.+)$/u;
/** Custody by its shape: a sealed member, a key or certificate, an env file. */
const CUSTODY = /(?:\.enc(?:\.yaml)?|\.pem|\.key|\.p12|\.pfx|(?:^|\/)\.env(?:\..*)?)$/u;
/** The statements a seed may not hold: each one changes the schema or its grants, which only a migration does. */
const SCHEMA_WORDS: ReadonlySet<string> = new Set(['create', 'alter', 'drop', 'truncate', 'grant', 'revoke', 'comment']);
/** The words that open a block around statements (a DO block's body is read as statements, so `do begin drop ...` is a DROP). */
const BLOCK_WORDS: ReadonlySet<string> = new Set(['do', 'begin']);
/** A test marker: an identity of the example.test domain, or a value that starts uat- or test-. */
const TEST_MARKER = /@example\.test\b|^(?:uat|test)[-_]/iu;
const DOCUMENT = /\.(?:json|ya?ml)$/u;

/** True for a tracked file of a seed level (the `.gitkeep` placeholders aside). */
export const isSeedFile = (file: string): boolean => SEED_PATH.test(file) && !file.endsWith(`/${SEEDS_KEEP}`);

/** The environments of the stack declaration of `repoRoot` with their runtime, or null when it declares none that parses to a mapping. */
export function declaredEnvironments(repoRoot: string): Map<string, string> | null {
  const environments = findStackDeclaration(repoRoot).doc?.environments;
  if (environments === null || typeof environments !== 'object' || Array.isArray(environments)) return null;
  return new Map(Object.entries(environments as Record<string, Parsed>).map(([name, entry]) => [name, String(entry?.runtime ?? '')]));
}

/** The literals of a seed document or SQL file, each with its line: SQL strings and bodies, or every string value of a JSON or YAML document. */
export function seedLiterals(file: string, text: string): Array<{ v: string; line: number }> {
  if (!DOCUMENT.test(file)) return databaseSqlTokens(text).flatMap((token) => (['string', 'body'].includes(token.t) ? [{ v: String(token.v), line: token.line }] : []));
  let doc: unknown;
  try { doc = file.endsWith('.json') ? JSON.parse(text) : parseYaml(text); } catch { return []; }
  const out: Array<{ v: string; line: number }> = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') out.push({ v: value, line: Math.max(1, text.slice(0, text.indexOf(value)).split('\n').length) });
    else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) visit(item);
  };
  visit(doc);
  return out;
}

/** The schema statements of one SQL seed: the line of each statement whose first word (past a block opener) changes the schema. */
function schemaStatements(text: string): Array<{ line: number; word: string }> {
  return databaseSqlStatements(databaseExecutableTokens(text)).flatMap((statement: Parsed) => {
    const first = statement.find((token: Parsed) => !(token.t === 'word' && BLOCK_WORDS.has(token.v)));
    return first?.t === 'word' && SCHEMA_WORDS.has(first.v) ? [{ line: first.line, word: String(first.v).toUpperCase() }] : [];
  });
}

/** Where one seed file sits: the shape finding of a file outside the kind folders, of an undeclared environment's level, or of custody. */
function shapeFinding(file: string, environments: Map<string, string> | null): Finding | null {
  const [, level = '', rest = ''] = SEED_PATH.exec(file) ?? [];
  const env = level.split('/')[1];
  if (CUSTODY.test(file)) return found(HFS_SEEDS_SHAPE, file, `${file} is custody, not seed data; a secret is sealed with sops at .starcistacks/<env>/secrets/<slug>.enc.yaml and read by *_FILE`);
  if (env !== SEEDS_DIR && environments !== null && !environments.has(String(env))) return found(HFS_SEEDS_SHAPE, file, `${file} is in the seed level of ${String(env)}, which is no environment of .starcistacks/application-stacks.yaml`);
  if (!LEVEL_FILE.test(rest)) return found(HFS_SEEDS_SHAPE, file, `${file} is no part of a seed level (${SEEDS_MANIFEST}, sql/, data/, files/); starci app codemod seeds-layout moves a loose seed into it`);
  return null;
}

/** The manifest findings of one level: its problems, and every file of its kind folders that no entry covers. */
function manifestFindings(repoRoot: string, level: SeedLevel, files: string[]): Finding[] {
  const manifest = `${level.dir}/${SEEDS_MANIFEST}`;
  const own = files.filter((file) => file.startsWith(`${level.dir}/`) && file !== manifest);
  if (own.length > 0 && !files.includes(manifest)) return [found(HFS_SEED_MANIFEST, manifest, `${level.dir} holds seed files but no ${SEEDS_MANIFEST}; every seed is an entry of its level's manifest`)];
  const covered = new Set(level.entries.flatMap((entry) => entryFiles(path.join(repoRoot, level.dir), entry).map((file) => `${level.dir}/${file}`)));
  return [
    ...level.problems.map((problem) => found(HFS_SEED_MANIFEST, manifest, `${manifest} ${problem.at}: ${problem.message}`)),
    ...own.filter((file) => !covered.has(file)).map((file) => found(HFS_SEED_MANIFEST, file, `${file} is listed by no entry of ${manifest}`)),
  ];
}

/** The findings of one entry's files: DDL in SQL, data that fails its schema, test markers where production applies the level. */
function entryFindings(repoRoot: string, level: SeedLevel, entry: SeedEntry, production: boolean): Finding[] {
  const findings: Finding[] = [];
  const schemaText = entry.schema === null ? null : readText(repoRoot, entry.schema);
  let schema: unknown = null;
  try { schema = schemaText === null ? null : parseYaml(schemaText); } catch { schema = null; }
  if (entry.kind === 'data' && schema === null) findings.push(found(HFS_SEED_DATA_SCHEMA, `${level.dir}/${SEEDS_MANIFEST}`, `entry ${entry.id} names the schema ${String(entry.schema)}, which is not a readable JSON or YAML schema`));
  for (const file of entryFiles(path.join(repoRoot, level.dir), entry).map((name) => `${level.dir}/${name}`)) {
    if (production && TEST_MARKER.test(path.posix.basename(file))) findings.push(found(HFS_SEED_TEST_DATA, file, `${file} is named as test data in a level a production environment applies`));
    const text = entry.kind === 'files' ? null : readText(repoRoot, file);
    if (text === null) continue;
    if (entry.kind === 'sql') for (const { line, word } of schemaStatements(text)) findings.push(found(HFS_SEED_DDL, file, `${file}:${line} runs ${word}, a schema change; seed data is never a migration: the schema change is a migration (BE-PERSISTENCE-1) and a seed only writes rows`, { line }));
    if (entry.kind === 'data' && schema !== null && DOCUMENT.test(file)) {
      let doc: unknown;
      try { doc = file.endsWith('.json') ? JSON.parse(text) : parseYaml(text); } catch { doc = undefined; }
      const errors = doc === undefined ? ['the document does not parse'] : validateAgainstSchema(doc, schema);
      if (errors.length > 0) findings.push(found(HFS_SEED_DATA_SCHEMA, file, `${file} does not validate against ${String(entry.schema)}: ${errors[0] ?? ''}`));
    }
    const marker = production ? seedLiterals(file, text).find((literal) => TEST_MARKER.test(literal.v)) : undefined;
    if (marker) findings.push(found(HFS_SEED_TEST_DATA, file, `${file}:${marker.line} holds test data (an example.test identity or a uat- or test- prefix) in a level a production environment applies`, { line: marker.line }));
  }
  return findings;
}

/** The findings of R375 over the tracked files of an app root. */
export function seedsFindings({ repoRoot, files }: { repoRoot: string; files: string[] }): Finding[] {
  const seeds = files.filter((file) => SEED_PATH.test(file));
  if (seeds.length === 0) return [];
  const environments = declaredEnvironments(repoRoot);
  const findings = seeds.flatMap((file) => shapeFinding(file, environments) ?? []);
  const placed = seeds.filter((file) => !findings.some((finding) => finding.path === file) && !file.endsWith(`/${SEEDS_KEEP}`));
  const shared = readSeedLevel(repoRoot, null);
  const levels = [shared, ...[...(environments ?? new Map<string, string>()).keys()].map((env) => readSeedLevel(repoRoot, env, new Set(shared.entries.map((entry) => entry.id))))];
  for (const level of levels) {
    findings.push(...manifestFindings(repoRoot, level, placed));
    const production = level.env === null || environments?.get(level.env) !== 'docker-compose';
    for (const entry of level.entries) findings.push(...entryFindings(repoRoot, level, entry, production));
  }
  return findings;
}
