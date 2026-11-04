import fs from 'node:fs';
import path from 'node:path';
import type { Prettier } from '../sync/format.mjs';
import { byCodeUnit } from '../runtime/scripts/lib/list.mjs';
import { formatted, prettierOf } from './app-prettier.mjs';

/** One file the migration writes, rewrites or deletes. */
export interface PassportModuleChange { file: string; action: 'add' | 'rewrite' | 'delete' }
/** One case left for a person. */
export interface PassportModuleFinding { file: string; code: string; reason: string }
/** The report of a migration (`starci app codemod passport-module`). */
export interface PassportModuleReport { schema: string; root: string; write: boolean; changes: PassportModuleChange[]; findings: PassportModuleFinding[] }
/** What `migratePassportModule` takes: the app root, whether to write, and the app's formatter (found in it when left out; null writes the template's own layout). */
export interface PassportModuleOptions { root: string; write?: boolean; prettier?: Prettier | null }

const GLUE = 'be/src/modules/integrations/passport';
const TEMPLATE_GLUE = path.join(import.meta.dirname, '..', 'templates', 'be', 'skeleton-lite', 'src', 'modules', 'integrations', 'passport');
const MODULE_FILES = ['passport.module-definition.ts', 'passport.module.ts'] as const;
const REGISTRATION = 'passport.registration.ts';
const INDEX_EXPORT = 'export { passportModule } from "./passport.registration"';
const MODULE_EXPORT = 'export { PassportModule } from "./passport.module"';
/** The one call shape the registration function took: `passportModule(<options>, { isGlobal: <boolean> })`. */
const CALL = /passportModule\(\s*([\w.]+)\s*,\s*\{\s*isGlobal:\s*(true|false)\s*\}\s*\)/g;
const IMPORT = /import \{([^}]*)\} from "@modules\/integrations\/passport"/;

/** The app files under `be/apps` that call the registration function, as root-relative paths. */
function callers(root: string): string[] {
  const apps = path.join(root, 'be', 'apps');
  if (!fs.existsSync(apps)) return [];
  return fs.readdirSync(apps, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') && fs.readFileSync(path.join(apps, name), 'utf8').includes('passportModule'))
    .map((name) => path.posix.join('be/apps', name.split(path.sep).join('/')))
    .sort(byCodeUnit);
}

/** A caller rewritten to the module's registration, or null when its call or its import is not the one shape the template rendered. */
export function rewriteCaller(text: string): string | null {
  const imported = IMPORT.exec(text);
  if (!imported?.[1]?.split(',').some((name) => name.trim() === 'passportModule')) return null;
  const calls = text.replace(CALL, (_call, options: string, isGlobal: string) => `PassportModule.register({ ...${options}, authenticator: PASSPORT_AUTHENTICATOR, isGlobal: ${isGlobal} })`);
  if (calls.includes('passportModule(')) return null;
  const names = imported[1].split(',').map((name) => name.trim()).filter((name) => name !== '' && name !== 'passportModule');
  const wanted = [...new Set([...names, 'PASSPORT_AUTHENTICATOR', 'PassportModule'])].sort(byCodeUnit);
  return calls.replace(IMPORT, `import { ${wanted.join(', ')} } from "@modules/integrations/passport"`);
}

/**
 * Migrate a lite app's passport glue from the registration function (`passport.registration.ts`, `passportModule(options, { isGlobal })`) to the
 * capability module every package-backed integration is (`PassportModule.register({ ...options, authenticator, isGlobal })` over
 * `passport.module-definition.ts`), which also hands the app's logger to @starci/auth. All or nothing: a glue or caller that left the rendered shape
 * is named for a person and nothing is written.
 */
export async function migratePassportModule({ root, write = false, prettier }: PassportModuleOptions): Promise<PassportModuleReport> {
  const report: PassportModuleReport = { schema: 'starci/passport-module-report@1', root, write, changes: [], findings: [] };
  const glue = path.join(root, GLUE);
  const registration = path.join(glue, REGISTRATION);
  if (!fs.existsSync(registration)) return report;
  const leftFor = (file: string, code: string, reason: string): void => { report.findings.push({ file, code, reason }); };
  for (const name of MODULE_FILES) if (fs.existsSync(path.join(glue, name))) leftFor(`${GLUE}/${name}`, 'PASSPORT_MODULE_PRESENT', `${GLUE}/${name} exists beside ${REGISTRATION}; move the callers of passportModule to PassportModule and delete ${REGISTRATION} by hand`);
  const writes = new Map<string, string>();
  const indexFile = `${GLUE}/index.ts`;
  const index = fs.existsSync(path.join(root, indexFile)) ? fs.readFileSync(path.join(root, indexFile), 'utf8') : '';
  if (index.includes(INDEX_EXPORT)) writes.set(indexFile, index.replace(INDEX_EXPORT, MODULE_EXPORT));
  else leftFor(indexFile, 'PASSPORT_INDEX_BY_HAND', `${indexFile} does not export passportModule from ./passport.registration as rendered; export PassportModule from ./passport.module by hand`);
  for (const file of callers(root)) {
    const rewritten = rewriteCaller(fs.readFileSync(path.join(root, file), 'utf8'));
    if (rewritten === null) leftFor(file, 'PASSPORT_CALL_BY_HAND', `${file} calls passportModule in another shape than passportModule(options, { isGlobal }); register PassportModule with the options, authenticator: PASSPORT_AUTHENTICATOR and isGlobal by hand`);
    else writes.set(file, rewritten);
  }
  if (report.findings.length) return report;
  for (const name of MODULE_FILES) writes.set(`${GLUE}/${name}`, fs.readFileSync(path.join(TEMPLATE_GLUE, name), 'utf8'));
  const formatter = prettier === undefined ? prettierOf(root, [path.join(root, 'be')]) : prettier ?? undefined;
  for (const [file, text] of writes) {
    report.changes.push({ file, action: MODULE_FILES.some((name) => file.endsWith(`/${name}`)) ? 'add' : 'rewrite' });
    if (write) fs.writeFileSync(path.join(root, file), formatter ? await formatted(formatter, root, path.join(root, file), text) : text);
  }
  report.changes.push({ file: `${GLUE}/${REGISTRATION}`, action: 'delete' });
  if (write) fs.rmSync(registration);
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the migration and what is left for a person as Markdown; JSON consumers read the same report object. */
export function passportModuleMarkdown(report: PassportModuleReport): string {
  const out = ['# passport-module', '', `${report.changes.length} file(s) ${report.write ? 'changed' : 'would change'}, ${report.findings.length} left for a person.`, ''];
  if (report.findings.length) {
    out.push('## Left for a person', '', '| file | code | reason |', '|---|---|---|');
    for (const finding of report.findings) out.push(`| ${cell(finding.file)} | ${finding.code} | ${cell(finding.reason)} |`);
    out.push('');
  }
  if (report.changes.length) {
    out.push('## Changed', '', '| file | action |', '|---|---|');
    for (const item of report.changes) out.push(`| ${cell(item.file)} | ${item.action} |`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}
