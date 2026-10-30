// scaffold-template-canon-be.spec.mjs - the skeleton's platform capabilities, code and specs, and the lite passport's declared-logic specs,
// pass the back-end canon they ship with, and so do the entity base of platform/database and the table entity that extends it, which
// the first `starci app add table` writes in either edition (persistence.md BE-PERSISTENCE-3, ruling entity-base).
// An app copies a platform capability byte-identical, so a skeleton file the canon refuses is a finding every app inherits
// and cannot fix. Each edition is scaffolded into a temp folder and every file under its src/modules/platform is linted, typed, with the
// starci-be rules of @starci/eslint-canon-be (the sibling package's built entry, typed by its declarations: the factory the rendered
// be/eslint.config.mjs calls). The parser reads a tsconfig that extends the app's own and adds only where this package's installs live, so the
// rules judge the real types of Nest, undici, node and the kit; the kit is copied to node_modules/@starci/jest-preset,
// where a rule recognises a kit double by its declaring package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import type { LockResult } from '../scaffold/app.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { addKind } from '../scaffold/add.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { gitAdd, installTypeScript } from './helpers/hfs-cli-fixture.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';
import { loadHfs, starciBeConfig } from '../../eslint-canon-be/dist/index.js';

const HFS = path.resolve(import.meta.dirname, '..');
const KIT = path.resolve(HFS, '..', 'jest-preset');
/** Where the types a skeleton file imports are installed: this package's dev dependencies and the kit's (jest's globals). */
const INSTALLS = [path.join(HFS, 'node_modules'), path.join(KIT, 'node_modules')];

const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** The canon's flat config with only its own starci-be rules on: the canon-be laws, not the stock rules it composes. */
const canonRulesOnly = (config: Linter.Config[]): Linter.Config[] => config.map((block) => (block.rules === undefined ? block : {
  ...block, rules: Object.fromEntries(Object.entries(block.rules).filter(([id]) => id.startsWith('starci-be/'))),
}));

/** A tsconfig beside the app's that resolves every package from the installs above; the app's own tsconfig stays as rendered. */
const lintProject = (be: string) => {
  const { paths } = JSON.parse(fs.readFileSync(path.join(be, 'tsconfig.json'), 'utf8')).compilerOptions;
  const file = path.join(be, 'tsconfig.canon.json');
  fs.writeFileSync(file, JSON.stringify({ extends: './tsconfig.json', compilerOptions: {
    typeRoots: INSTALLS.map((dir) => path.join(dir, '@types')), types: ['node', 'jest'],
    paths: { ...paths, '*': INSTALLS.map((dir) => path.join(dir, '*')) },
  } }));
  return file;
};

/** The kit, built, where an app installs it. */
const installKit = (root: string) => {
  for (const part of ['package.json', 'dist']) fs.cpSync(path.join(KIT, part), path.join(root, 'node_modules', '@starci', 'jest-preset', part), { recursive: true });
};

/** The entity base of platform/database and the entity of the table `add table` writes over a postgres connection. */
const ENTITY_BASE = 'src/modules/platform/database/abstract.entity.ts';
const TABLE_ENTITY = 'src/modules/domain/widgets/persistence/entities/widgets.entity.ts';

/**
 * The connection retry window of the rendered DatabaseModule: an app that boots beside the db service of its stack waits about 30 s
 * (10 attempts 3 s apart) for it, never the ~3 s of TypeORM's default that exits the first start and rolls the release back.
 */
const assertConnectRetry = (module: string) => {
  assert.match(module, /^const CONNECT_RETRY = \{ retryAttempts: 10, retryDelay: 3000 \} as const$/mu);
  const registrations = module.split('TypeOrmModule.forRoot(').slice(1);
  assert.ok(registrations.length > 0 && registrations.every((call) => /^\{[^}]*\.\.\.CONNECT_RETRY,/u.test(call)), 'every connection takes the retry window');
  assert.doesNotMatch(module, /retryAttempts: (?!10\b)\d+/u);
};

/** Adds one table the way `starci app add table` does; a full app's starter connection names no provider, so it is declared postgres. */
const addTable = (root: string) => {
  const file = path.join(root, 'hfs.json');
  const hfs = JSON.parse(fs.readFileSync(file, 'utf8'));
  hfs.sides.be.connections = hfs.sides.be.connections.map((connection: Record<string, unknown>) => ({ provider: 'postgres', ...connection }));
  fs.writeFileSync(file, `${JSON.stringify(hfs, null, 2)}\n`);
  addKind({ repoRoot: root, noun: 'table', name: 'widgets' });
};

for (const edition of ['full', 'lite']) {
  test(`the ${edition} skeleton's platform capabilities pass the starci-be canon`, { timeout: 300_000 }, async (t) => {
    const { root } = scaffoldApp({ name: 'demo', into: mkdtemp(t, 'starci-template-canon-be-'), harness: { version: '1.1.0-alpha.3' }, edition,
      presets: bundledPresets(), lock: lockedOk, initGit: init });
    assert.equal(fs.existsSync(path.join(root, 'be', ENTITY_BASE)), false, 'a starter carries no entity base: no starter table extends it (R25)');
    assertConnectRetry(fs.readFileSync(path.join(root, 'be', 'src/modules/platform/database/database.module.ts'), 'utf8'));
    addTable(root);
    gitAdd(installTypeScript(root));
    installKit(root);
    const be = path.join(root, 'be');
    const project = lintProject(be);
    // reason: the canon answers typescript-eslint's FlatConfig blocks; they are eslint's flat config, but under exactOptionalPropertyTypes its
    // LanguageOptions lacks the index signature eslint's own type declares, so the one boundary is named here.
    const config = canonRulesOnly(await starciBeConfig({ hfs: loadHfs(pathToFileURL(path.join(be, 'eslint.config.mjs')).href) }) as Linter.Config[]);
    assert.ok(config.some((block) => Object.keys(block.rules ?? {}).includes('starci-be/http-needs-timeout')), 'the canon rules are on');
    const eslint = new ESLint({ cwd: be, overrideConfigFile: true, errorOnUnmatchedPattern: false, overrideConfig: [
      ...config, { files: ['**/*.ts'], languageOptions: { parserOptions: { projectService: false, project, tsconfigRootDir: be } } },
    ] });
    // lite also lints the specs beside the logic files be.integrations.passport declares (`logic`): unit specs held to the canon form.
    const passportSpecs = edition === 'lite' ? ['tokens', 'password', 'cookie'].map((part) => `src/modules/integrations/passport/passport.${part}.spec.ts`) : [];
    const results = await eslint.lintFiles(['src/modules/platform/**/*.ts', TABLE_ENTITY, ...passportSpecs]);
    const linted = results.map((result) => path.relative(be, result.filePath).split(path.sep).join('/'));
    assert.ok(linted.includes('src/modules/platform/http/fetch-http-client.client.ts'), 'the client is linted');
    assert.ok(linted.includes('src/modules/platform/http/fetch-http-client.client.spec.ts'), 'its spec is linted');
    for (const spec of passportSpecs) assert.ok(linted.includes(spec), `${spec} is linted`);
    assert.ok(linted.includes(ENTITY_BASE) && linted.includes(TABLE_ENTITY), 'the entity base and the table entity extending it are linted');
    const entity = fs.readFileSync(path.join(be, TABLE_ENTITY), 'utf8');
    assert.match(entity, /extends UuidAbstractEntity \{/u);
    assert.doesNotMatch(entity, /name: "(?:id|created_at|updated_at)"/u, 'the table entity inherits id and its timestamps');
    assert.match(fs.readFileSync(path.join(be, 'src/modules/platform/database/index.ts'), 'utf8'), /^export \{ UuidAbstractEntity \} from "\.\/abstract\.entity"$/mu);
    const findings = results.flatMap((result) => result.messages.map((message) => `${path.relative(be, result.filePath).split(path.sep).join('/')}:${message.line} ${message.ruleId ?? 'parse'} ${message.message}`));
    assert.deepEqual(findings, []);
  });
}
