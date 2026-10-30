// Hermetic apps for the architecture machine specs: a temp git repo with the app-root hfs.json, and in one side folder a
// tsconfig and the files a spec lists. The subset of @starci/hfs's src/helpers/hfs-arch-fixture.mjs that this package's
// specs use; the whole-machine runner (checkArchitecture) belongs to @starci/hfs and is not copied here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import type { TestContext } from 'node:test';
import type tsModule from 'typescript';
import type { AppDeclaration, SideDeclaration } from './app.ts';

const require = createRequire(import.meta.url);

/** The TypeScript compiler the fixture's apps are typed with. */
export const ts: typeof tsModule = require('typescript') as typeof tsModule;

/** One app of a side: its name and kind. */
type AppEntry = { readonly name: string; readonly kind: string };

/** The default apps of each side. */
export const DEFAULT_APPS: Readonly<Record<'be' | 'fe', readonly AppEntry[]>> = { be: [{ name: 'core', kind: 'api' }], fe: [{ name: 'web', kind: 'next' }] };

/** Write `files` (relative path to content; null skips) under `root`. */
export function writeFiles(root: string, files: Readonly<Record<string, string | null>>): void {
  for (const [relative, content] of Object.entries(files)) {
    if (content === null) continue;
    const target = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

/** The app hfs.json of a fixture about one side: `fields` (apps, optionalSlots, connections, reads) for `side`, the smallest other side. */
export function appDeclaration(side: 'be' | 'fe', fields: SideDeclaration, project = 'fixture'): AppDeclaration {
  const other = { be: { apps: [{ name: 'core', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } };
  return { hfs: 3, kind: 'app', project, sides: { ...other, [side]: fields } };
}

/**
 * A hermetic app whose `profile` side the machine judges: the app root holds hfs.json and the one package.json, the side folder
 * (`<app>/<profile>`, the returned root) a permissive tsconfig.json and (be) apps/core/src/{main.ts,app.module.ts} or (fe) a Next
 * app shell. `files` maps side-relative paths to content (null removes a default file); a path that starts with `../` is written
 * at the app root (`../package.json` replaces the app's manifest). `declaration` overrides parts of the side's declaration. The
 * app is a git repo with the files staged (not committed).
 */
export function archFixture(
  t: TestContext,
  { profile = 'be', files = {}, declaration = {}, apps = DEFAULT_APPS[profile] }: {
    profile?: 'be' | 'fe';
    files?: Readonly<Record<string, string | null>>;
    declaration?: SideDeclaration;
    apps?: readonly AppEntry[];
  } = {},
): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), `starci-hfs-arch-${profile}-`));
  t.after(() => { fs.rmSync(appRoot, { recursive: true, force: true }); });
  const root = path.join(appRoot, profile);
  const app = apps[0]?.name;
  if (app === undefined) throw new Error('an arch fixture needs at least one app');
  const baseline: Record<string, string> = {
    '../hfs.json': `${JSON.stringify(appDeclaration(profile, { apps, ...declaration }), null, 2)}\n`,
    '../package.json': JSON.stringify({ name: 'fixture', private: true }),
    'tsconfig.json': `${JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'preserve', allowJs: true, skipLibCheck: true, noEmit: true, experimentalDecorators: true },
      include: ['src/**/*', 'apps/**/*'],
    }, null, 2)}\n`,
    ...(profile === 'be' ? {
      [`apps/${app}/src/main.ts`]: 'void 0;\n',
      [`apps/${app}/src/app.module.ts`]: 'export const AppModule = 1;\n',
    } : {
      [`apps/${app}/src/app/.keep`]: '',
      // every fe app is an npm workspace with its own manifest (HFS_MONO_FE_WORKSPACE)
      ...Object.fromEntries(apps.map((entry) => [`apps/${entry.name}/package.json`, JSON.stringify({ name: `@fixture/${entry.name}`, private: true })])),
    }),
  };
  fs.mkdirSync(root, { recursive: true });
  writeFiles(root, { ...baseline, ...files });
  execFileSync('git', ['init', '-q'], { cwd: appRoot });
  execFileSync('git', ['add', '-A'], { cwd: appRoot });
  return root;
}
