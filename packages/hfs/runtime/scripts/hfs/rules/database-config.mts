// database-config.mjs - the database content checks of db/ (R259: extensions, custody SQL, destructive migrations, seed data). It starts no
// database and no Docker process.
import { found, readText } from './read.mjs';
import {
  DB_EXTENSION_ALLOWED, DB_VAULT_WRITE, HFS_SEED_PII, isActiveMigration, SEED_FILE,
} from './database-constants.mjs';
import { databaseExecutableTokens, databaseSqlStatements, databaseSqlTokens, destructiveMigrationFindings } from './database-migrations.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

const DEFAULT_EXTENSIONS = ['pgcrypto', 'pg_trgm', 'vector', 'uuid-ossp', 'unaccent', 'btree_gist', 'pgmq'];
const word = (token: Parsed, value: Parsed) => token?.t === 'word' && token.v === value;
const identifier = (token: Parsed) => token && ['word', 'ident'].includes(token.t) ? token.v : null;

function dbParameters(manifest: Parsed) {
  const declared = manifest?.ruleParams?.db ?? {};
  return {
    extensions: Array.isArray(declared.extensions) ? declared.extensions : DEFAULT_EXTENSIONS,
  };
}

function qualifiedName(tokens: Parsed, index: number) {
  const name = identifier(tokens[index]);
  if (name === null) return null;
  return tokens[index + 1]?.v === '.' && identifier(tokens[index + 2]) !== null
    ? { schema: name, name: identifier(tokens[index + 2]), next: index + 3 }
    : { schema: 'public', name, next: index + 1 };
}

function extensionFindings(file: string, tokens: Parsed, allowed: Parsed) {
  const findings = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!word(tokens[index], 'create') || !word(tokens[index + 1], 'extension')) continue;
    let at = index + 2;
    if (word(tokens[at], 'if') && word(tokens[at + 1], 'not') && word(tokens[at + 2], 'exists')) at += 3;
    const name = identifier(tokens[at]);
    if (name !== null && !allowed.has(name)) findings.push(found(DB_EXTENSION_ALLOWED, file,
      `${file}:${tokens[index].line} enables extension ${name}, which ruleParams.db.extensions does not allow`, { line: tokens[index].line, extension: name }));
  }
  return findings;
}

function vaultWriteAt(tokens: Parsed, index: number) {
  const token = tokens[index];
  if (identifier(token) === 'vault' && tokens[index + 1]?.v === '.' && tokens[index + 3]?.v === '(') {
    return ['create_secret', 'update_secret', 'delete_secret'].includes(identifier(tokens[index + 2]));
  }
  let at = null;
  if (word(token, 'insert') || word(token, 'merge')) at = word(tokens[index + 1], 'into') ? index + 2 : null;
  if (word(token, 'delete')) at = word(tokens[index + 1], 'from') ? index + 2 : null;
  if (word(token, 'update')) at = index + 1;
  if (word(token, 'truncate')) return truncatedVault(tokens, index);
  if (at === null) return false;
  if (word(tokens[at], 'only')) at += 1;
  return qualifiedName(tokens, at)?.schema === 'vault';
}

function truncatedVault(tokens: Parsed, index: number) {
  let at = word(tokens[index + 1], 'table') ? index + 2 : index + 1;
  while (at < tokens.length) {
    if (word(tokens[at], 'only')) at += 1;
    const name = qualifiedName(tokens, at);
    if (!name) return false;
    if (name.schema === 'vault') return true;
    if (tokens[name.next]?.v !== ',') return false;
    at = name.next + 1;
  }
  return false;
}

function passwordStatement(statement: Parsed) {
  const starts = statement.findIndex((token: Parsed, index: number) => (word(token, 'create') || word(token, 'alter'))
    && (word(statement[index + 1], 'role') || word(statement[index + 1], 'user')));
  return starts !== -1 && statement.slice(starts + 2).some((token: Parsed) => word(token, 'password')) ? statement[starts] : null;
}

function custodySqlFindings(file: string, tokens: Parsed) {
  const findings = [];
  for (const statement of databaseSqlStatements(tokens)) {
    const password = passwordStatement(statement);
    if (password) findings.push(found(DB_VAULT_WRITE, file,
      `${file}:${password.line} sets a role password in a migration; provision credentials through sealed secret custody`, { line: password.line, operation: 'role-password' }));
    const vault = statement.find((_token, index) => vaultWriteAt(statement, index));
    if (vault) findings.push(found(DB_VAULT_WRITE, file,
      `${file}:${vault.line} writes to vault; migration SQL never provisions secret values`, { line: vault.line, operation: 'vault-write' }));
  }
  return findings;
}

const EMAIL_LITERAL = /^[A-Z0-9._%+-]+@([A-Z0-9-]+(?:\.[A-Z0-9-]+)+)$/i;
function piiLiteral(value: Parsed) {
  if (value.split(/[^\w.%+@-]+/).some((part: Parsed) => {
    const email = EMAIL_LITERAL.exec(part);
    return email && email[1]!.toLowerCase() !== 'example.test';
  })) return true;
  if (!/^\+?[\d\s().-]+$/.test(value)) return false;
  const digits = value.replaceAll(/\D/g, '');
  if (digits.length < 9 || digits.length > 15 || /^\d{4}-\d{2}-\d{2}(?:\s|$)/.test(value)) return false;
  return value.startsWith('+') || /[()\s]/.test(value) || /^\d{10,15}$/.test(value);
}

function seedPiiFindings(repoRoot: string, seeds: Parsed) {
  const findings = [];
  for (const file of seeds) {
    const text = readText(repoRoot, file);
    if (text === null) continue;
    for (const token of databaseSqlTokens(text)) {
      if (!['string', 'body'].includes(token.t) || !piiLiteral(token.v)) continue;
      findings.push(found(HFS_SEED_PII, file, `${file}:${token.line} contains an email or phone literal; seed data uses synthetic identities and the example.test domain`, { line: token.line }));
    }
  }
  return findings;
}

/** R259 config/content checks, synchronously judged at the app root for both editions. */
export function databaseConfigFindings({ repoRoot, files = [], all = files, repo = {}, manifest, isRoot, inScope = () => true }: { repoRoot: string; files?: string[]; all?: string[]; repo?: Repo; manifest: Parsed; isRoot: boolean; inScope?: (file: string) => boolean }) {
  if (isRoot === false || ['be', 'fe'].some((value) => value === repo.profile)) return [];
  const parameters = dbParameters(manifest);
  const migrations = all.filter((file: string) => isActiveMigration(file) && file.endsWith('.sql')).sort(byCodeUnit);
  const sources = migrations.map((file: string) => ({ file, tokens: databaseExecutableTokens(readText(repoRoot, file) ?? '') }));
  const findings = [];
  for (const { file, tokens } of sources) findings.push(...extensionFindings(file, tokens, new Set(parameters.extensions)), ...custodySqlFindings(file, tokens));
  findings.push(...destructiveMigrationFindings({ repoRoot, migrations, files: all }));
  const seeds = all.filter((file: string) => file === SEED_FILE || /^\.starcistacks\/[^/]+\/seeds\/.+\.sql$/.test(file));
  findings.push(...seedPiiFindings(repoRoot, seeds));
  return findings.filter((finding) => inScope(finding.path));
}
