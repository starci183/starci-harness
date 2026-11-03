import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextStamp } from '../db/new.mjs';
import { MIGRATIONS_DIR } from '../runtime/scripts/hfs/rules/database-constants.mjs';
import { filesUnder, relativePosix } from './source-tree.mjs';

/** One migration the codemod writes (or would write). */
export interface AccountDoorsChange { file: string; phase: 'expand' | 'contract'; why: string }
/** One case left for a person. */
export interface AccountDoorsFinding { file: string; reason: string }
/** The report of the upgrade (`starci app codemod account-doors`). */
export interface AccountDoorsReport {
  schema: string; root: string; write: boolean; phase: 'expand' | 'contract'; changes: AccountDoorsChange[]; findings: AccountDoorsFinding[]; next: string[];
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The owner of the account doors: the partial the lite baseline includes, byte for byte. */
const DOORS_PARTIAL = path.join(PACKAGE_ROOT, 'templates', 'app', 'auth-doors.sql.partial');
/** One door of the partial: its name, its argument types, its function text and its REVOKE and GRANT lines. */
interface Door { name: string; types: string; block: string; grants: string }
/** A grant to anyone on schema auth or on a table in it. */
const AUTH_GRANT = /\bgrant\b[^;]*?\bon\b\s+(?:schema\s+auth\b|(?:table\s+)?auth\.)/iu;
const EXPAND_NAME = 'account-doors';
const CONTRACT_NAME = 'contract_revoke-auth-grants';
const SOURCE = /\.[cm]?tsx?$/iu;
const ENTITY_FILES = ['auth-user.entity.ts', 'auth-identity.entity.ts'];

/** The argument types of a signature, the `p_` parameter names dropped and case and spacing folded: a door is known by its name and types alone. */
const typesOf = (args: string): string => args.split(',').map((arg) => arg.trim().replace(/^p_\w+\s+/u, '').replace(/\s+/gu, ' ').toLowerCase()).join(', ');

/** The partial split into its head (the comment and the index) and its doors, in the partial's order. */
function partialParts(text: string): { head: string; doors: Door[] } {
  const lines = text.split('\n');
  const doors = [...text.matchAll(/^(?:-- [^\n]*\n)?CREATE FUNCTION public\.(\w+)\(([^)]*)\)[\s\S]*?\$\$;\n/gmu)].map((match): Door => {
    const own = lines.filter((line) => /^(?:REVOKE|GRANT) EXECUTE ON FUNCTION public\.(\w+)\(/u.exec(line)?.[1] === match[1] && typesOf(/\(([^)]*)\)/u.exec(line)![1]!) === typesOf(match[2]!));
    return { name: match[1]!, types: typesOf(match[2]!), block: match[0], grants: `${own.join('\n')}\n` };
  });
  return { head: text.slice(0, text.indexOf(doors[0]!.block)), doors };
}

/** The doors a text defines, as name(types) keys. */
const definedDoors = (statements: string): string[] =>
  [...statements.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([^)]*)\)/giu)].map((match) => `${match[1]!.toLowerCase()}(${typesOf(match[2]!)})`);

const migrationsOf = (root: string): string[] => {
  const dir = path.join(root, MIGRATIONS_DIR);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort() : [];
};

const textOf = (root: string, name: string): string => fs.readFileSync(path.join(root, MIGRATIONS_DIR, name), 'utf8');
/** The statements of a migration, its line comments left out. */
const statementsOf = (root: string, name: string): string => textOf(root, name).replace(/--[^\n]*/gu, '');

/** The application role hfs.json declares (`db.appRole`), app_be by default. */
function appRoleOf(root: string): string {
  const role = (JSON.parse(fs.readFileSync(path.join(root, 'hfs.json'), 'utf8')) as { db?: { appRole?: unknown } }).db?.appRole;
  return typeof role === 'string' && /^[a-z_][a-z0-9_]*$/u.test(role) ? role : 'app_be';
}

/** The be source that still maps or names the auth tables: an entity of schema auth, or the retired entity files. */
function accountTableReferences(root: string): string[] {
  const be = path.join(root, 'be', 'src');
  if (!fs.existsSync(be)) return [];
  return filesUnder(be, SOURCE).map((file) => relativePosix(root, file)).filter((file) => {
    const retired = ENTITY_FILES.some((name) => file.endsWith(`/${name}`));
    return retired || /schema:\s*["']auth["']/u.test(fs.readFileSync(path.join(root, file), 'utf8'));
  });
}

function contractText(role: string): string {
  return [
    '-- contract: the back end reaches auth.users and auth.identities through the account doors (public.be_auth_*), so the application role',
    '-- gives up its direct grants. The release before the doors still reads those tables, so a rollback to it after the accept needs them granted again.',
    `revoke select, insert, update on table auth.users from ${role};`,
    `revoke select, insert on table auth.identities from ${role};`,
    `revoke usage on schema auth from ${role};`,
    '',
  ].join('\n');
}

/**
 * Upgrade of a lite app that signs in over direct grants on auth.users and auth.identities to the account doors. The expand step (default)
 * writes the migration that creates the doors the app lacks, with the text the lite baseline includes; the app then runs `starci app sync --execute`
 * (the sign-in glue switches to the doors and the two entity files go). The contract step (`contract`) writes the migration that revokes the three
 * grants, once the doors exist and no be source maps the auth tables; R255 reports the grants until that migration is in the chain. Nothing is written while a case is left for a person, and a step that is already
 * done changes nothing.
 */
export function migrateAccountDoors({ root, write = false, contract = false, now = Date.now }: { root: string; write?: boolean; contract?: boolean; now?: () => number }): AccountDoorsReport {
  const phase = contract ? 'contract' : 'expand';
  const report: AccountDoorsReport = { schema: 'starci/account-doors-report@1', root, write, phase, changes: [], findings: [], next: [] };
  const declaration = JSON.parse(fs.readFileSync(path.join(root, 'hfs.json'), 'utf8')) as { edition?: unknown };
  if (declaration.edition !== 'lite') {
    report.findings.push({ file: 'hfs.json', reason: 'the account doors belong to the lite edition; a full app signs in through its identity provider' });
    return report;
  }
  const names = migrationsOf(root);
  const parts = partialParts(fs.readFileSync(DOORS_PARTIAL, 'utf8'));
  const defined = new Set(names.flatMap((name) => definedDoors(statementsOf(root, name))));
  const missing = parts.doors.filter((door) => !defined.has(`${door.name}(${door.types})`));
  const stamp = nextStamp(names, now());
  if (!contract) {
    if (!missing.length) return report;
    const file = `${MIGRATIONS_DIR}/${stamp}_${EXPAND_NAME}.sql`;
    const kept = missing.length === parts.doors.length ? 'all' : missing.map((door) => door.name).join(', ');
    report.changes.push({ file, phase, why: `creates the account doors the app lacks (${kept}; SECURITY DEFINER, pinned search_path, EXECUTE for the application role alone) and the lower(email) index the by-address door reads` });
    report.next.push('run `npx starci app sync --execute` (the sign-in glue moves onto the doors and the retired entity files are deleted), then verify and release both together',
      'then run `npx starci app codemod account-doors --contract --execute` to revoke the old grants (R255 reports them until that migration is in the chain) and release the three together');
    const text = `${parts.head}${missing.map((door) => door.block).join('\n')}\n${missing.map((door) => door.grants).join('')}`;
    if (write) fs.writeFileSync(path.join(root, file), text, { flag: 'wx' });
    return report;
  }
  if (missing.length) report.findings.push({ file: MIGRATIONS_DIR, reason: `no migration defines the account doors ${missing.map((door) => door.name).join(', ')}: run the expand step first` });
  for (const file of accountTableReferences(root)) {
    report.findings.push({ file, reason: 'still maps or names the auth tables; run `npx starci app sync --execute` so the sign-in glue uses the doors, and release that before the contract migration' });
  }
  if (report.findings.length) return report;
  if (names.some((name) => name.includes(`_${CONTRACT_NAME}`)) || !names.some((name) => AUTH_GRANT.test(statementsOf(root, name)))) return report;
  const file = `${MIGRATIONS_DIR}/${stamp}_${CONTRACT_NAME}.sql`;
  report.changes.push({ file, phase, why: 'revokes the direct grants on schema auth, auth.users and auth.identities from the application role' });
  report.next.push('the deploy applies it right after the accept; the release before the doors cannot sign in after a rollback unless the grants are given back');
  if (write) fs.writeFileSync(path.join(root, file), contractText(appRoleOf(root)), { flag: 'wx' });
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the migrations and what is left for a person as Markdown; JSON consumers read the same report object. */
export function accountDoorsMarkdown(report: AccountDoorsReport): string {
  const out = ['# account-doors', '', `Step ${report.phase}: ${report.changes.length} migration${report.changes.length === 1 ? '' : 's'} ${report.write ? 'written' : 'to write'}, ${report.findings.length} left for a person.`, ''];
  if (report.findings.length) {
    out.push('## Left for a person', '', '| location | reason |', '|---|---|');
    for (const finding of report.findings) out.push(`| ${cell(finding.file)} | ${cell(finding.reason)} |`);
    out.push('');
  }
  if (report.changes.length) {
    out.push('## Migrations', '', '| file | step | why |', '|---|---|---|');
    for (const change of report.changes) out.push(`| ${cell(change.file)} | ${change.phase} | ${cell(change.why)} |`);
    out.push('');
  }
  if (report.next.length) out.push('## Next', '', ...report.next.map((line) => `- ${line}`), '');
  return `${out.join('\n')}\n`;
}
