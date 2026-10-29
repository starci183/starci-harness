// database-config.mjs - the database content checks of db/ (R259: extensions, custody SQL, destructive migrations, seed data). It starts no
// database and no Docker process.
import { found, readText } from './read.mjs';
import {
  DB_EXTENSION_ALLOWED, DB_VAULT_WRITE, HFS_SEED_PII, isActiveMigration, SEED_FILE,
} from './database-constants.mjs';
import { databaseExecutableTokens, databaseSqlStatements, databaseSqlTokens, destructiveMigrationFindings } from './database-migrations.mjs';
import { byCodeUnit } from '../../lib/list.mjs';

const DEFAULT_EXTENSIONS = ['pgcrypto', 'pg_trgm', 'vector', 'uuid-ossp', 'unaccent', 'btree_gist', 'pgmq'];
const word = (token, value) => token?.t === 'word' && token.v === value;
const identifier = (token) => token && ['word', 'ident'].includes(token.t) ? token.v : null;

function dbParameters(manifest) {
  const declared = manifest?.ruleParams?.db ?? {};
  return {
    extensions: Array.isArray(declared.extensions) ? declared.extensions : DEFAULT_EXTENSIONS,
  };
}

function qualifiedName(tokens, index) {
  const name = identifier(tokens[index]);
  if (name === null) return null;
  return tokens[index + 1]?.v === '.' && identifier(tokens[index + 2]) !== null
    ? { schema: name, name: identifier(tokens[index + 2]), next: index + 3 }
    : { schema: 'public', name, next: index + 1 };
}

function extensionFindings(file, tokens, allowed) {
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

function vaultWriteAt(tokens, index) {
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

function truncatedVault(tokens, index) {
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

function passwordStatement(statement) {
  const starts = statement.findIndex((token, index) => (word(token, 'create') || word(token, 'alter'))
    && (word(statement[index + 1], 'role') || word(statement[index + 1], 'user')));
  return starts !== -1 && statement.slice(starts + 2).some((token) => word(token, 'password')) ? statement[starts] : null;
}

function custodySqlFindings(file, tokens) {
  const findings = [];
  for (const statement of databaseSqlStatements(tokens)) {
    const password = passwordStatement(statement);
    if (password) findings.push(found(DB_VAULT_WRITE, file,
      `${file}:${password.line} sets a role password in a migration; provision credentials through sealed secret custody`, { line: password.line, operation: 'role-password' }));
    const vault = statement.find((token, index) => vaultWriteAt(statement, index));
    if (vault) findings.push(found(DB_VAULT_WRITE, file,
      `${file}:${vault.line} writes to vault; migration SQL never provisions secret values`, { line: vault.line, operation: 'vault-write' }));
  }
  return findings;
}

function policyTarget(statement, start) {
  const on = statement.findIndex((token, index) => index > start && word(token, 'on'));
  return on === -1 ? null : qualifiedName(statement, on + 1);
}

function policyRoles(statement) {
  const to = statement.findIndex((token) => word(token, 'to'));
  if (to === -1) return null;
  const end = statement.findIndex((token, index) => index > to && (word(token, 'using') || word(token, 'with')));
  return statement.slice(to + 1, end === -1 ? undefined : end).map(identifier).filter(Boolean);
}

function applyPublicReadPolicy(statement, policies) {
  const at = statement.findIndex((token, index) => ['create', 'alter', 'drop'].some((verb) => word(token, verb)) && word(statement[index + 1], 'policy'));
  if (at === -1) return;
  const verb = statement[at].v;
  let nameAt = at + 2;
  if (word(statement[nameAt], 'if') && word(statement[nameAt + 1], 'exists')) nameAt += 2;
  const name = identifier(statement[nameAt]);
  const target = policyTarget(statement, nameAt);
  if (!name || !target) return;
  const key = `${target.schema}.${target.name}.${name}`;
  if (verb === 'drop') { policies.delete(key); return; }
  const rename = statement.findIndex((token) => word(token, 'rename'));
  if (verb === 'alter' && word(statement[rename + 1], 'to')) {
    const nextName = identifier(statement[rename + 2]);
    if (nextName && policies.has(key)) {
      policies.set(`${target.schema}.${target.name}.${nextName}`, { ...policies.get(key), name: nextName });
      policies.delete(key);
    }
    return;
  }
  const roles = policyRoles(statement);
  if (verb === 'alter') {
    if (policies.has(key) && roles !== null) policies.set(key, { ...policies.get(key), roles });
    return;
  }
  const forAt = statement.findIndex((token) => word(token, 'for'));
  policies.set(key, { name, schema: target.schema, select: word(statement[forAt + 1], 'select'), roles: roles ?? ['public'] });
}

const EMAIL_LITERAL = /^[A-Z0-9._%+-]+@([A-Z0-9-]+(?:\.[A-Z0-9-]+)+)$/i;
function piiLiteral(value) {
  if (value.split(/[^\w.%+@-]+/).some((part) => {
    const email = EMAIL_LITERAL.exec(part);
    return email && email[1].toLowerCase() !== 'example.test';
  })) return true;
  if (!/^\+?[\d\s().-]+$/.test(value)) return false;
  const digits = value.replaceAll(/\D/g, '');
  if (digits.length < 9 || digits.length > 15 || /^\d{4}-\d{2}-\d{2}(?:\s|$)/.test(value)) return false;
  return value.startsWith('+') || /[()\s]/.test(value) || /^\d{10,15}$/.test(value);
}

function seedPiiFindings(repoRoot, seeds) {
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
export function databaseConfigFindings({ repoRoot, files = [], all = files, repo = {}, manifest, isRoot, inScope = () => true }) {
  if (isRoot === false || ['be', 'fe'].includes(repo.profile)) return [];
  const parameters = dbParameters(manifest);
  const migrations = all.filter((file) => isActiveMigration(file) && file.endsWith('.sql')).sort(byCodeUnit);
  const sources = migrations.map((file) => ({ file, tokens: databaseExecutableTokens(readText(repoRoot, file) ?? '') }));
  const findings = [];
  for (const { file, tokens } of sources) findings.push(...extensionFindings(file, tokens, new Set(parameters.extensions)), ...custodySqlFindings(file, tokens));
  findings.push(...destructiveMigrationFindings({ repoRoot, migrations, files: all }));
  const seeds = all.filter((file) => file === SEED_FILE || /^\.starcistacks\/[^/]+\/seeds\/.+\.sql$/.test(file));
  findings.push(...seedPiiFindings(repoRoot, seeds));
  return findings.filter((finding) => inScope(finding.path));
}
