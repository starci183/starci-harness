import fs from 'node:fs';
import path from 'node:path';

/** One rewrite of the report: a token name or a selector moved onto HeroUI's theme. */
export interface ThemeChange { file: string; line: number; from: string; to: string }
/** One thing the codemod leaves for a person. */
export interface ThemeFinding { file: string; line: number; code: 'THEME_PRIVATE_TOKEN' | 'THEME_SELECTOR' | 'THEME_ROOT_PROP'; text: string; reason: string }
/** The report of a migration (`starci app codemod theme-tokens`). */
export interface ThemeReport { schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[]; changes: ThemeChange[]; findings: ThemeFinding[] }

const GENERATED = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage', '.git']);

/** Core's private colour names and the HeroUI token each one became (the grammar reads HeroUI's, grammar audit 2026-11 section 8). */
export const CORE_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  accent: 'accent', 'accent-foreground': 'accent-foreground', 'accent-text': 'accent-soft-foreground', 'accent-soft': 'accent-soft', focus: 'focus',
  canvas: 'background', surface: 'surface', 'surface-secondary': 'surface-secondary', 'surface-tertiary': 'surface-tertiary', foreground: 'foreground',
  muted: 'muted', border: 'border', separator: 'separator', success: 'success', 'success-foreground': 'success-foreground', warning: 'warning',
  'warning-foreground': 'warning-foreground', danger: 'danger', 'danger-foreground': 'danger-foreground', info: 'info', 'info-foreground': 'info-foreground',
  'surface-shadow': 'surface-shadow', 'control-radius': 'radius', 'terminal-background': 'terminal-background', 'terminal-foreground': 'terminal-foreground',
  'terminal-title-foreground': 'terminal-title-foreground',
});

/** Offset Pop's private names: its ink is `--foreground`, its pink `--accent`, its yellow, mint and critical the status tones. */
export const OFFSET_POP_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  ...CORE_TOKENS, ink: 'foreground', pink: 'accent', blush: 'accent-soft', yellow: 'warning', mint: 'success', critical: 'danger', 'surface-shadow': 'surface-shadow',
});

const FAMILY_ROOT = String.raw`(?:\.grammar-common-root)?\[data-grammar-family=["'][a-z][a-z0-9-]*["']\]`;
const MODE = (name: string): string => String.raw`\[data-grammar-theme=["']${name}["']\]`;
const FAMILY_DARK = new RegExp(`^(?:${FAMILY_ROOT}${MODE('dark')}|\\.dark\\s+${FAMILY_ROOT}|${FAMILY_ROOT}\\.dark)$`);
const FAMILY_LIGHT = new RegExp(`^${FAMILY_ROOT}(?:${MODE('light')}|${MODE('system')})?$`);
/** Tokens the grammar still reads from the app: Offset Pop's offset colour, the bare-mark hooks, and the sticky-band geometry hosts write. */
const KEPT = /^--(?:offset-pop-shadow-ink|starci-core-(?:mark-(?:danger|warning)|(?:band|rail|subnav)[a-z-]*))$/;
const PRIVATE = /--(starci-core|offset-pop)-([a-z][a-z0-9-]*)/g;

/** The mapped name of one private token, or null when HeroUI has no token for it. */
const mapped = (prefix: string, name: string): string | null => (prefix === 'starci-core' ? CORE_TOKENS : OFFSET_POP_TOKENS)[name] ?? null;

/** One stylesheet or component file rewritten; `changes` and `findings` carry 1-based lines. */
export function transformThemeTokens({ text, file = '' }: { text: string; file?: string }): { text: string; changes: ThemeChange[]; findings: ThemeFinding[] } {
  const changes: ThemeChange[] = [];
  const findings: ThemeFinding[] = [];
  const isCss = file.endsWith('.css') || file === '';
  const lines = text.split('\n').map((line, index) => {
    const number = index + 1;
    let out = line;
    if (isCss) {
      // A selector line: each selector of the list is either a scope that is now `:root` or `.dark`, or left for a person.
      if (/\{\s*$/.test(line) && !/^\s*(?:@|\/\*|\*)/.test(line) && /data-grammar-(?:family|theme)/.test(line)) {
        const open = line.lastIndexOf('{');
        const parts = line.slice(0, open).split(',').map((part) => part.trim());
        const rewritten = parts.map((part) => (FAMILY_DARK.test(part) ? '.dark' : FAMILY_LIGHT.test(part) ? ':root' : part));
        for (const [at, part] of parts.entries()) {
          if (rewritten[at] !== part) changes.push({ file, line: number, from: part, to: rewritten[at] ?? part });
          else if (/data-grammar-(?:family|theme)/.test(part)) findings.push({ file, line: number, code: 'THEME_SELECTOR', text: part, reason: 'a scope inside the page (a nested root, a part of a family) is not a theme scope: set HeroUI tokens on the element\'s own rule, or on :root and .dark' });
        }
        out = `${line.slice(0, line.length - line.trimStart().length)}${[...new Set(rewritten)].join(', ')} {`;
      }
      out = out.replace(PRIVATE, (token: string, prefix: string, name: string) => {
        const to = mapped(prefix, name);
        if (to === null) {
          if (!KEPT.test(token)) findings.push({ file, line: number, code: 'THEME_PRIVATE_TOKEN', text: token, reason: 'the grammar defines no such token any more; set HeroUI\'s --radius, --surface-shadow or the colour token it follows, or drop the line' });
          return token;
        }
        changes.push({ file, line: number, from: token, to: `--${to}` });
        return `--${to}`;
      });
    } else {
      const root = /<(?:Core|OffsetPop)?GrammarRoot\b[^>]*\btheme=/.exec(line);
      if (root !== null) findings.push({ file, line: number, code: 'THEME_ROOT_PROP', text: root[0], reason: 'GrammarRoot theme sets nothing now: remove it and put `.dark` on html (the app owns the mode)' });
    }
    return out;
  });
  return { text: lines.join('\n'), changes, findings };
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return GENERATED.has(entry.name) ? [] : sourceFiles(full);
    return /\.(?:css|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Rewrites an app's stylesheets onto HeroUI's tokens (`write` false is a dry run) and reports what a person finishes. */
export function migrateThemeTokens({ root, write = false }: { root: string; write?: boolean }): ThemeReport {
  const frontend = path.join(root, 'fe');
  if (!fs.statSync(frontend, { throwIfNoEntry: false })?.isDirectory()) throw new Error('theme-tokens runs at an app root with a fe/ directory');
  const report: ThemeReport = { schema: 'starci/theme-tokens-codemod@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [] };
  for (const target of sourceFiles(frontend)) {
    const file = path.relative(root, target).split(path.sep).join('/');
    const original = fs.readFileSync(target, 'utf8');
    const result = transformThemeTokens({ text: original, file });
    report.filesScanned += 1;
    report.changes.push(...result.changes);
    report.findings.push(...result.findings);
    if (result.text !== original) {
      report.filesChanged.push(file);
      if (write) fs.writeFileSync(target, result.text);
    }
  }
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the migration and what is left for a person as Markdown; JSON consumers read the same report object. */
export function themeTokensMarkdown(report: ThemeReport): string {
  const out = [`# theme-tokens`, '', `Scanned ${report.filesScanned} files, ${report.filesChanged.length} ${report.write ? 'changed' : 'would change'}, ${report.changes.length} rewrites, ${report.findings.length} left for a person.`, ''];
  if (report.findings.length) {
    out.push('## Left for a person', '', '| file | line | code | text | reason |', '|---|---|---|---|---|');
    for (const finding of report.findings) out.push(`| ${cell(finding.file)} | ${finding.line} | ${finding.code} | \`${cell(finding.text)}\` | ${cell(finding.reason)} |`);
    out.push('');
  }
  if (report.changes.length) {
    out.push('## Rewrites', '', '| file | line | from | to |', '|---|---|---|---|');
    for (const change of report.changes) out.push(`| ${cell(change.file)} | ${change.line} | \`${cell(change.from)}\` | \`${cell(change.to)}\` |`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}
