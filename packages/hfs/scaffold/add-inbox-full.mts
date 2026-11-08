// The delivery inbox of a FULL app: platform/inbox (the Inbox port every webhook intake claims its delivery key on first, R263
// `webhook-inbox-key`) and platform/idempotency (its error family and messages), laid down by `starci app add webhook <name>` and
// alone by `starci app add inbox` (no operand; a no-op when the capability is there).
//
// The files are the idempotency pattern topic's platform tree (knowledge/patterns/be/idempotency.yaml), written whole or not at all.
// The capability's catalogs join the app the way the other platform capabilities' do: its entities and migrations into the database
// connection and its error kinds and messages into the errors and i18n modules of each app's compose/platform.ts, anchored on the
// http-security catalogs every full app carries. Its module is composed once, in the webhooks area group, by add.mts (`wireFeature`).
// Lite keeps its own inbox (add-inbox-lite.mts) and never reaches this module.
import fs from 'node:fs';
import path from 'node:path';
import { ScaffoldError } from './service.mjs';
import { planTopicPlatform } from './add-plan.mjs';
import type { PlannedFile } from './add-plan.mjs';
import { compositionCode } from './add-compose.mjs';

const TOPIC = 'idempotency';
const IMPORT_STATEMENT = /^import\b[^;]*?\bfrom\s+"([^"]+)";?/gm;

/** A file rewritten in place. */
interface TextPatch {
  readonly file: string;
  readonly text: string;
}

/** What the full inbox adds to the app, planned before anything is written. */
export interface FullInboxPlan {
  /** The platform files not yet in the app (empty when the capability is there). */
  readonly files: readonly PlannedFile[];
  /** The platform composition files that gain the capability's catalogs. */
  readonly patches: readonly TextPatch[];
  /** Whether the webhooks area group still has to register InboxModule. */
  readonly compose: boolean;
  /** True when the plan changes nothing. */
  readonly empty: boolean;
  /** Writes the files and patches; answers the app-relative paths it wrote. */
  apply(): string[];
}

/** One catalog of the capability: the http-security token it follows and what it adds there. */
interface Step {
  readonly anchor: string;
  readonly adds: ReadonlyArray<{ readonly symbol: string, readonly spread: boolean, readonly source: string }>;
  readonly required: boolean;
}

const STEPS: readonly Step[] = [
  { anchor: '...httpSecurityEntities', adds: [{ symbol: 'inboxEntities', spread: true, source: 'inbox' }], required: true },
  { anchor: '...httpSecurityMigrations', adds: [{ symbol: 'inboxMigrations', spread: true, source: 'inbox' }], required: true },
  { anchor: 'HTTP_SECURITY_ERROR_KINDS', adds: [{ symbol: 'INBOX_ERROR_KINDS', spread: false, source: 'inbox' }, { symbol: 'IDEMPOTENCY_ERROR_KINDS', spread: false, source: 'idempotency' }], required: false },
  { anchor: 'HTTP_SECURITY_MESSAGES', adds: [{ symbol: 'INBOX_MESSAGES', spread: false, source: 'inbox' }, { symbol: 'IDEMPOTENCY_MESSAGES', spread: false, source: 'idempotency' }], required: false },
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const read = (file: string) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const posix = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/');

/** The end of the last import statement: the active code of a composition file starts there. */
function importsEnd(text: string): number {
  let end = 0;
  for (const match of text.matchAll(IMPORT_STATEMENT)) end = Math.max(end, match.index + match[0].length);
  return end;
}

/** Adds `import { symbols } from "@modules/platform/<capability>"` in the sorted run of the platform imports (else after the last import). */
function addImport(text: string, capability: string, symbols: readonly string[]): string {
  const source = `@modules/platform/${capability}`;
  const line = `import { ${symbols.join(', ')} } from "${source}"`;
  const before = [...text.matchAll(IMPORT_STATEMENT)].find((match) => match[1]!.startsWith('@modules/platform/') && match[1]! > source);
  if (before) return `${text.slice(0, before.index)}${line}\n${text.slice(before.index)}`;
  const end = importsEnd(text);
  return `${text.slice(0, end)}\n${line}${text.slice(end)}`;
}

/** Inserts `additions` right after the first active occurrence of `anchor`: on its own line when it has one, else in line. */
function insertAfter(text: string, anchor: string, additions: readonly string[]): string | null {
  const start = importsEnd(text);
  const code = compositionCode(text);
  const own = new RegExp(`^([ \\t]*)${escape(anchor)},?[ \\t]*$`, 'm');
  const ownMatch = own.exec(code.slice(start));
  if (ownMatch) {
    const at = start + ownMatch.index + ownMatch[0].length;
    return `${text.slice(0, at)}${additions.map((addition) => `\n${ownMatch[1]}${addition},`).join('')}${text.slice(at)}`;
  }
  const inline = new RegExp(`(?<![\\w.])${escape(anchor)}(?![\\w])`).exec(code.slice(start));
  if (!inline) return null;
  const at = start + inline.index + inline[0].length;
  return wrapLongArray(`${text.slice(0, at)}${additions.map((addition) => `, ${addition}`).join('')}${text.slice(at)}`, at);
}

const PRINT_WIDTH = 120;

/** The line holding `at`, an array of plain names that now exceeds the print width, written one element per line as prettier prints it. */
function wrapLongArray(text: string, at: number): string {
  const from = text.lastIndexOf('\n', at) + 1;
  const to = text.indexOf('\n', at) < 0 ? text.length : text.indexOf('\n', at);
  const line = text.slice(from, to);
  const array = /^(\s*)(.*\[)([^[\]()]*)\](,?)$/.exec(line);
  if (line.length <= PRINT_WIDTH || !array) return text;
  const [, indent = '', head = '', items = '', tail = ''] = array;
  const elements = items.split(',').map((item) => item.trim()).filter(Boolean);
  const wrapped = [`${indent}${head}`, ...elements.map((element) => `${indent}    ${element},`), `${indent}]${tail}`].join('\n');
  return `${text.slice(0, from)}${wrapped}${text.slice(to)}`;
}

/** The composition file of one app with the capability's catalogs added; null when it is not a database composition or already carries them. */
function catalogPatch(file: string, relative: string): string | null {
  let text = read(file);
  if (!/\bDatabaseModule\.register\(/.test(compositionCode(text))) return null;
  if (compositionCode(text).includes('inboxEntities')) return null;
  const used = new Map<string, string[]>();
  for (const step of STEPS) {
    const additions = step.adds.map((add) => add.spread ? `...${add.symbol}` : add.symbol);
    const next = insertAfter(text, step.anchor, additions);
    if (next === null) {
      if (!step.required) continue;
      throw new ScaffoldError('HFS_ADD_WIRE_INVALID', `add webhook | inbox registers the inbox catalogs in ${relative}, which has no ${step.anchor} to follow: add ${step.adds.map((add) => add.spread ? `...${add.symbol}` : add.symbol).join(', ')} to its database connection by hand, then run the verb again`);
    }
    text = next;
    for (const add of step.adds) used.set(add.source, [...(used.get(add.source) ?? []), add.symbol]);
  }
  const sorted = (symbols: readonly string[]) => [...symbols].sort();
  for (const capability of ['idempotency', 'inbox']) if (used.has(capability)) text = addImport(text, capability, sorted(used.get(capability)!));
  return text;
}

/** Every composition file of a declared app that holds a database connection (the api's and the cli's compose/platform.ts). */
function platformCompositions(repoRoot: string, apps: ReadonlyArray<{ name: string }>): string[] {
  return apps.map((app) => path.join(repoRoot, 'be', 'apps', app.name, 'src', 'compose', 'platform.ts')).filter((file) => fs.existsSync(file));
}

/** Whether an app already registers InboxModule in its composition (any argument): it is registered once per app. */
function inboxComposed(repoRoot: string, apps: ReadonlyArray<{ name: string }>): boolean {
  return apps.some((app) => {
    const src = path.join(repoRoot, 'be', 'apps', app.name, 'src');
    const files = [path.join(src, 'app.module.ts'), ...(fs.existsSync(path.join(src, 'compose')) ? fs.readdirSync(path.join(src, 'compose')).map((name) => path.join(src, 'compose', name)) : [])];
    return files.some((file) => file.endsWith('.ts') && fs.existsSync(file) && /\bInboxModule\.register\(/.test(compositionCode(fs.readFileSync(file, 'utf8'))));
  });
}

/**
 * Plans the inbox capability of a full app; null in a lite app (its inbox is add-inbox-lite.mts). The plan names every file it
 * writes and every composition file it edits, and throws before any of them is touched when an anchor is missing.
 */
export function planFullInbox({ repoRoot, repo }: { repoRoot: string, repo: { readonly edition?: string, readonly sides: { readonly be: { readonly apps: ReadonlyArray<{ readonly name: string, readonly kind: string }> } } } }): FullInboxPlan | null {
  if (repo.edition === 'lite') return null;
  const apps = repo.sides.be.apps;
  const files = planTopicPlatform({ repoRoot, topic: TOPIC });
  // The catalogs follow the files: a capability the owner wrote by hand registers itself.
  const patches = files.length === 0 ? [] : platformCompositions(repoRoot, apps).flatMap((file): TextPatch[] => {
    const text = catalogPatch(file, posix(repoRoot, file));
    return text === null ? [] : [{ file, text }];
  });
  const compose = !inboxComposed(repoRoot, apps);
  return {
    files, patches, compose, empty: files.length === 0 && patches.length === 0 && !compose,
    apply(): string[] {
      for (const file of files) {
        fs.mkdirSync(path.dirname(file.absolute), { recursive: true });
        fs.writeFileSync(file.absolute, file.body);
      }
      for (const patch of patches) fs.writeFileSync(patch.file, patch.text);
      return [...files.map((file) => posix(repoRoot, file.absolute)), ...patches.map((patch) => posix(repoRoot, patch.file))];
    },
  };
}
