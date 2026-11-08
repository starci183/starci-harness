import fs from 'node:fs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { refusal } from '../stack/errors.mjs';
import { byCodeUnit } from '../report/order.mjs';
import { ENTITY_LIST } from '../db/entity-list.mjs';
import { isBranchPattern, readBranchProfiles, type BranchProfiles } from '../runtime/scripts/lib/stack-declaration.mjs';

// reason: the stack declaration and its quality services are YAML parsed from disk; each field is read where the CI text needs it
type Declaration = any;

/** The app source facts the CI text reads (sync/index.mts appSource). */
interface CiSource { runtimeExample?: boolean; files?: string[]; read?: (file: string) => string; stack?: { imageEnvironments?: Record<string, unknown> } }

// One command vocabulary for managed CI rendering and the runtime coverage gate.
const exampleCommand = (source: CiSource | undefined, command: string): string => source?.runtimeExample
  ? 'node node_modules/@starci/hfs/runtime/scripts/hfs/example-secrets.mjs --run . -- ' + command
  : command;

const UPLOAD_ARTIFACT = 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2';
const DOWNLOAD_ARTIFACT = 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0';
// Sonar and the Codecov upload run on every full run (a release tag or a candidate), so a release is analysed before it ships, and on a push to a branch
// whose profile reports that gate (the plan's `sonar` and `codecov` outputs); the plan job decides. Only a full run judges: the Sonar quality gate step runs
// on a full run alone, so a report run analyses and uploads but its findings never fail it.
const FULL_RUN = "needs.plan.outputs.full == 'true'";
const reportRun = (gate: 'sonar' | 'codecov'): string => `needs.plan.outputs.${gate} == 'report'`;
const runsOn = (gate: 'sonar' | 'codecov'): string => `\${{ !cancelled() && (${FULL_RUN} || ${reportRun(gate)}) }}`;
const JUDGES = `\${{ !cancelled() && ${FULL_RUN} }}`;

/** A declaration key as a bash case pattern: a name quoted whole, a pattern with each literal part quoted and `*` left bare. */
const casePattern = (branch: string): string => branch.split('*').map((part) => (part === '' ? '' : JSON.stringify(part))).join('*');

/** The modes the plan of a push to each profile branch sets: the branch profiles of the declaration whose sound entries lower sonar or codecov, or name a branch at all. */
function planBranchProfiles(profiles: BranchProfiles): string {
  // A branch's own entry comes before the patterns, as profileFor picks it; a pattern is a bash case glob with its literal parts quoted (`"ui/"*`).
  const branches = Object.entries(profiles.profiles).sort(([a], [b]) => Number(isBranchPattern(a)) - Number(isBranchPattern(b)));
  if (branches.length === 0) return '';
  const cases = branches.map(([branch, gates]) => {
    const lowered = (['sonar', 'codecov'] as const).map((gate) => `${gate}=${gates[gate] ?? 'blocking'}`).join(' ');
    const named = Object.entries(gates).filter(([, mode]) => mode !== 'blocking').map(([gate, mode]) => `${gate} ${String(mode)}`).join(', ') || 'every gate blocking';
    return `              ${casePattern(branch)}) ${lowered} note="branch profile ${branch}: checks only; ${named} (.starcistacks/application-stacks.yaml branches)" ;;`;
  });
  return ['', '          if [[ "$EVENT" == push && "$REF_TYPE" == branch ]]; then', '            case "$GITHUB_REF_NAME" in', ...cases, '            esac', '          fi'].join('\n');
}

/** The push filter lines of the profile branches (block-sequence entries under on.push.branches), or nothing. */
const pushProfileBranches = (profiles: BranchProfiles): string => Object.keys(profiles.profiles).map((branch) => `      - ${JSON.stringify(branch)}`).join('\n');

/** Codecov uploads on every full run and on a push to a branch whose profile reports codecov, with its required authentication; a missing report, an unavailable endpoint or a rejected upload fails the job. */
function codecovSteps(lcovReport: string, codecov: Declaration): string {
  if (codecov.enabled === false || codecov.wiring === 'not-used') return [
    '      - name: coverage upload',
    '        run: echo "codecov disabled in .starcistacks/application-stacks.yaml"',
  ].join('\n');
  return [
    '      - name: coverage upload',
    '        uses: codecov/codecov-action@0fb7174895f61a3b6b78fc075e0cd60383518dac # v5.5.5',
    `        if: ${runsOn('codecov')}`,
    '        with:',
    codecov.auth === 'token' ? `          token: \${{ secrets.${codecov.token} }}` : '          use_oidc: true',
    `          files: ${lcovReport}`,
    '          disable_search: true',
    '          fail_ci_if_error: true',
  ].join('\n');
}

/**
 * Sonar is required: on every full run, and on a push to a branch whose profile reports it, it consumes the test coverage and lint artifacts, and a missing
 * token fails the job with a clear refusal (custody, not a finding). The quality gate step judges on a full run only.
 */
function sonarJob(sonar: Declaration, lcovReport: string, lcovArtifact: string, nodeMajor: string, timeout: string, scopes: readonly string[], rootPackages: boolean): string {
  if (!sonar) return '';
  const condition = runsOn('sonar');
  const host = sonar.hostSecret ? `\${{ secrets.${sonar.hostSecret} }}` : sonar.provider === 'sonarcloud' ? 'https://sonarcloud.io' : `\${{ vars.${sonar.hostVar} }}`;
  const header = [
    '  sonar:',
    '    needs: [plan, lint, coverage]',
    `    if: \${{ ${FULL_RUN} || ${reportRun('sonar')} }}`,
    `    timeout-minutes: ${timeout}`,
    '    runs-on: ubuntu-latest',
    '    env:',
    `      SONAR_TOKEN: \${{ secrets.${sonar.token} }}`,
    `      SONAR_HOST_URL: ${host}`,
    '    steps:',
  ].join('\n');
  const steps = [
    '      - name: Sonar token',
    `        if: ${condition}`,
    '        run: |',
    `          if [ -z "$SONAR_TOKEN" ]; then echo "::error::SONAR_TOKEN is not set: Sonar is required, so a missing token fails this job (secret ${sonar.token})"; exit 1; fi`,
    '          if [ -z "$SONAR_HOST_URL" ]; then echo "::error::SONAR_HOST_URL is not set: the declared analysis endpoint is required"; exit 1; fi',
    `      - uses: ${DOWNLOAD_ARTIFACT}`,
    `        if: ${condition}`,
    '        with:',
    `          name: ${lcovArtifact}`,
    `          path: ${lcovReport.split('/').slice(0, -1).join('/') || '.'}`,
    `      - uses: ${DOWNLOAD_ARTIFACT}`,
    `        if: ${condition}`,
    '        with:',
    '          pattern: sonar-lint-*',
    '          path: reports',
    '          merge-multiple: true',
    ...sonarMergeSteps(condition, scopes),
    // The scan's TypeScript program resolves a root package through its manifest's exports, into its dist, as the lint does.
    ...(rootPackages ? [packagesBuildStep(true, condition)] : []),
    '      - uses: SonarSource/sonarqube-scan-action@c7ee0f9df90b7aa20e8dcf9695dcfe2e7da5b4f2 # v7.2.1',
    `        if: ${condition}`,
    '      - uses: SonarSource/sonarqube-quality-gate-action@7a5fffe8e523c40e0c740b6bc2712ab503e52efa # v1.2.1',
    `        if: ${JUDGES}`,
    '        timeout-minutes: 10',
  ].join('\n');
  // Variable strings are inserted after render() expands partials, so resolve Sonar's shared install partial before insertion.
  const read = (name: string): string => fs.readFileSync(new URL('../templates/app/ci-workflows/' + name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  return read('sonar-steps.yml')
    .replace('{{> app/ci-workflows/install-steps.yml}}', () => read('install-steps.yml').trimEnd())
    .replaceAll('{{nodeMajor}}', nodeMajor)
    .replace('{{sonarJobHeader}}', () => header)
    .replace('{{sonarJobSteps}}', () => steps)
    .trimEnd() + '\n';
}

/** The app source reader is be-relative; the authored manifest lives one directory above that side. */
function buildDeclaration(source: CiSource | undefined): Declaration {
  if (!source?.read) return {};
  try {
    return parseYaml(source.read('../.starcistacks/application-stacks.yaml')) ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

/** Static CI values are strings with valid environment names; expressions cannot turn public config into runtime secret reads. */
function mergeBuildValues(values: Map<string, string>, entries: Record<string, unknown> | null | undefined): void {
  for (const [key, value] of Object.entries(entries ?? {})) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key) || typeof value !== 'string' || value.includes('${{')) {
      throw refusal('STACK_BUILD_ARG_INVALID', 'CI build values must map environment names to literal strings');
    }
    if (values.has(key) && values.get(key) !== value) {
      throw refusal('STACK_BUILD_ARG_INVALID', 'CI build values disagree for ' + key);
    }
    values.set(key, value);
  }
}

/** Image values own their keys; the build-fe gate supplies only missing keys, and sealed members stay unopened. */
function imageBuildEnv(image: Declaration, gates: Declaration[]): string {
  const values = new Map<string, string>();
  mergeBuildValues(values, image?.buildArgs?.values);
  const fallback = new Map<string, string>();
  for (const gate of gates.filter((entry: Declaration) => entry.name === 'build-fe')) mergeBuildValues(fallback, gate.env);
  for (const [key, value] of fallback) if (!values.has(key)) values.set(key, value);
  if (!values.size) return '';
  return ['        env:', ...[...values.keys()].sort(byCodeUnit).map(key => '          ' + key + ': ' + JSON.stringify(values.get(key)))].join('\n');
}

/** Multiple deployed front ends build separately through the installed turbo (a run step has no node_modules/.bin on PATH), so each fe/apps/<app> and its dependencies see its own public values; the root packages are built first, as `npm run build:fe` does. */
function frontendBuild(source: CiSource | undefined, app: { sides: { fe: { apps: readonly { name: string }[] } } } | undefined, modulesFirst: string): { env: string; steps: string } {
  const declaration = buildDeclaration(source);
  const environments = Object.keys(source?.stack?.imageEnvironments ?? {});
  const environment = (environments.length > 1 ? 'production' : environments[0]) as string;
  const images = Object.values(declaration.environments?.[environment]?.deploy?.images ?? {}) as Declaration[];
  const frontend = images.filter(image => app?.sides.fe.apps.some(entry => entry.name === image.app));
  const gates = declaration.release?.gates ?? [];
  const singleEnv = imageBuildEnv(frontend[0], gates);
  if (frontend.length <= 1) return { env: singleEnv, steps: ['      - name: build fe', '        run: npm run build:fe', singleEnv].filter(Boolean).join('\n') };
  const steps = frontend.map(image => [
    '      - name: build fe ' + image.app,
    '        run: ' + modulesFirst + 'npm run codegen --silent && npx --no-install turbo run build --filter=./fe/apps/' + image.app,
    imageBuildEnv(image, gates),
  ].filter(Boolean).join('\n')).join('\n');
  return { env: singleEnv, steps };
}

/** The per-scope lint reports (one artifact per lint matrix scope) join into the one reports/lint.sonar.json the Sonar import reads, even when one scope wrote none. The local release gate writes the same file with mergeSonarReports (release/lint-report.mts): keep both identical. */
function sonarMergeSteps(condition: string, scopes: readonly string[]): string[] {
  return [
    '      - name: merge Sonar lint reports',
    `        if: ${condition}`,
    '        run: |',
    "          node --input-type=module <<'NODE'",
    "          import fs from 'node:fs';",
    `          const files = [${scopes.map((scope) => `'reports/lint.${scope}.sonar.json'`).join(', ')}];`,
    "          const reports = files.filter(file => fs.existsSync(file)).map(file => JSON.parse(fs.readFileSync(file, 'utf8')));",
    '          const rules = [...new Map(reports.flatMap(report => report.rules).map(rule => [rule.id, rule])).values()];',
    '          const issues = reports.flatMap(report => report.issues);',
    "          fs.mkdirSync('reports', { recursive: true });",
    "          fs.writeFileSync('reports/lint.sonar.json', JSON.stringify({ rules, issues }, null, 2) + '\\n');",
    '          NODE',
  ];
}

const STANDARD = new URL('../runtime/knowledge/hfs/ci-standard.yaml', import.meta.url);

/**
 * The command that builds the app's root workspace packages (the agent SDK, the module packages and every other `packages/*` workspace): the managed
 * `build:modules` script, which sync renders exactly when the app has root packages (sync/index.mts appScripts) and which the managed typecheck, lint,
 * test and build scripts already run first. A CI step that runs a check directly (the boot proof, the app check's lint, the Sonar analysis) reads the
 * packages' declared types from their dist, so it runs this first; an app with no root package renders no such step and no prefix.
 */
export const BUILD_MODULES = 'npm run build:modules --silent';

/** The CI step that builds the root packages, at the indent of a job's steps, under `condition` when given; empty for an app without root packages. */
export function packagesBuildStep(rootPackages: boolean, condition?: string): string {
  if (!rootPackages) return '';
  return ['      - name: build the workspace packages', ...(condition ? [`        if: ${condition}`] : []), `        run: ${BUILD_MODULES}`].join('\n');
}
/** jest --shard=i/N gives each shard ceil(specs / N) spec files in order, so shard N is empty unless (N - 1) * ceil(specs / N) < specs. */
export function filledShards(specs: number, wanted: number): number {
  for (let shards = wanted; shards > 1; shards -= 1) if ((shards - 1) * Math.ceil(specs / shards) < specs) return shards;
  return 1;
}

/** The unit specs of the be source: every *.spec.ts outside the test kind folders (src/tests/<kind>), the files the unit project runs. */
const unitSpecCount = (source: CiSource | undefined): number => (source?.files ?? []).filter((file) => file.endsWith('.spec.ts') && !file.includes('/tests/')).length;

/** The files ESLint judges in a scope (`be`, `fe` or the root `packages`): its tracked script sources. */
const LINTED = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const lintedFiles = (source: CiSource | undefined, scope: string): number => (source?.files ?? []).filter((file) => file.startsWith(`${scope}/`) && LINTED.test(file)).length;

/**
 * The liveness budget, in minutes, of an ESLint child that judges `files` files: the CLI's rule (heavyTimeoutMinutes of the eslint kind,
 * max(base, rate x files / 1000)), from the environment the CLI sets for this package; null when it is not set (a run outside the CLI).
 */
export function eslintBudgetMinutes(files: number, env: NodeJS.ProcessEnv = process.env): number | null {
  const base = Number(env.STARCI_ESLINT_TIMEOUT_MINUTES);
  const rate = Number(env.STARCI_ESLINT_MINUTES_PER_1000_FILES);
  if (!Number.isFinite(base) || base <= 0) return null;
  return Number.isFinite(rate) && rate > 0 ? Math.max(base, (rate * files) / 1000) : base;
}

/**
 * The timeout of the lint matrix: the manifest's ci.jobs.lint.timeoutMinutes when it declares one, else the larger of the standard's default
 * and the ESLint budget of the largest scope plus lintOverheadMinutes, so a cold or large-diff lint ends by the child's budget, never the job's.
 */
export function lintJobTimeout({ declared, fallback, overhead, scopeFiles, env = process.env }: { declared: unknown; fallback: number; overhead: number; scopeFiles: readonly number[]; env?: NodeJS.ProcessEnv }): number {
  if (declared !== undefined) return Number(declared);
  const budget = eslintBudgetMinutes(Math.max(0, ...scopeFiles), env);
  return budget === null ? fallback : Math.max(fallback, Math.ceil(budget) + overhead);
}

/** The per-job settings of the managed CI: ci.jobs.<job>.timeoutMinutes and ci.jobs.test.shards of the manifest over the defaults of the CI standard, the shards capped at the count the unit specs fill (an empty shard would fail, never pass empty). */
function ciJobSettings(declaration: Declaration, source: CiSource | undefined, scopes: readonly string[]): Record<string, string> {
  const { defaults, heap, lintOverheadMinutes, suitesPerShard } = parseYaml(fs.readFileSync(STANDARD, 'utf8'));
  const jobs = declaration?.ci?.jobs ?? {};
  const timeout = (job: string): string => String(jobs[job]?.timeoutMinutes ?? defaults.timeoutMinutes[job]);
  const specs = unitSpecCount(source);
  const wanted = Number(jobs.test?.shards ?? Math.max(Number(defaults.shards), Math.ceil(specs / Number(suitesPerShard))));
  const shards = source?.files?.length ? filledShards(specs, wanted) : wanted;
  return {
    nodeOptions: `--max-old-space-size=${heap.minMiB}`,
    timeoutFast: timeout('fast'),
    timeoutLint: String(lintJobTimeout({ declared: jobs.lint?.timeoutMinutes, fallback: Number(defaults.timeoutMinutes.lint), overhead: Number(lintOverheadMinutes), scopeFiles: scopes.map((scope) => lintedFiles(source, scope)) })), timeoutTest: timeout('test'), timeoutCoverage: timeout('coverage'),
    timeoutBuild: timeout('build'), timeoutSonar: timeout('sonar'), timeoutDbTypes: timeout('db-types'),
    testShards: `[${Array.from({ length: shards }, (_, index) => index + 1).join(', ')}]`, testShardTotal: String(shards),
    // The sharded cache verify (cache-verify.yml) runs each family as a job of its own; a job may take as long as the longest family job of ci.yml.
    timeoutVerify: String(Math.max(Number(timeout('lint')), Number(timeout('test')), Number(timeout('build')))),
  };
}

/**
 * The shards of the cache verify (cache-verify.yml), as the block list of the `args` of its matrix (the lines Prettier keeps for a list this long): one `starci app check --fresh` job per family the committed cache holds records of
 * (the families `app check` caches; the audit and the Sonar scan keep no record), the lint family once per side of the lint matrix of ci.yml. Each job recomputes its
 * family from scratch and fails when the committed records are not the ones it produced.
 */
export function verifyShards(scopes: readonly string[]): string {
  const gates = ['hfs', 'secrets', 'format', 'db', 'wiring', 'types', 'test', 'build'];
  return [...gates.map((gate) => `--gate ${gate}`), ...scopes.map((side) => `--gate lint --side ${side}`)].map((args) => `          - ${JSON.stringify(args)}`).join(String.fromCharCode(10));
}

/** An omitted quality declaration preserves hosted Sonar, required OIDC Codecov, and the high production dependency audit. */
export function ciWorkflowCommands(source: CiSource | undefined, lcovReport = 'be/coverage/lcov.info', quality: Declaration = undefined, { nodeMajor = '22', app, packages = false, rootPackages = false }: { nodeMajor?: string; packages?: boolean; rootPackages?: boolean; app?: { sides: { fe: { apps: readonly { name: string }[] } } } } = {}): Record<string, string> {
  const configuredSonar = quality === undefined ? { token: 'SONAR_TOKEN', hostVar: 'SONAR_HOST_URL' } : quality.sonar;
  const sonar = configuredSonar?.wiring === 'not-used' || configuredSonar?.mode === 'disabled' ? null : configuredSonar;
  const codecov = quality?.codecov ?? { enabled: true, auth: 'oidc' };
  const audit = quality?.audit ?? { level: 'high', omitDev: true };
  const lcovArtifact = 'coverage-lcov';
  // The root packages are built before every step that reads their types or compiles app code (BUILD_MODULES): an app without one renders as before.
  const modulesFirst = rootPackages ? `${BUILD_MODULES} && ` : '';
  const build = frontendBuild(source, app, modulesFirst);
  const side = '${{ matrix.side }}';
  // The lint matrix: one job per side, and one for the root packages of an app that has them (their scope runs whatever became of the sides').
  const scopes = ['be', 'fe', ...(rootPackages ? ['packages'] : [])];
  const declaration = buildDeclaration(source);
  const settings = ciJobSettings(declaration, source, scopes);
  const lintInputs = exampleCommand(source, modulesFirst + (packages ? 'npm run codegen --silent && npx --no-install turbo run build --filter=./fe/packages/*' : 'npm run codegen --silent'));
  // A refused branches block renders no profile (readBranchProfiles keeps only the sound entries; the app check names the problems).
  const profiles = readBranchProfiles(declaration);
  return {
    ...settings,
    pushProfileBranches: pushProfileBranches(profiles),
    planBranchProfiles: planBranchProfiles(profiles),
    lintSides: `[${scopes.join(', ')}]`,
    lcovShardsDir: lcovReport.split('/').slice(0, -1).concat('shards').join('/'),
    // The istanbul JSON a shard writes beside the lcov (STARCI_COVERAGE_SHARD=1): what the coverage job merges.
    shardCoverageReport: lcovReport.split('/').slice(0, -1).concat('coverage-final.json').join('/'),
    // The fast job's boot proof compiles every app root, which imports the root packages: the step that builds them precedes it.
    ciPackagesBuild: packagesBuildStep(rootPackages),
    ciBuildEnv: build.env,
    ciBuildSteps: build.steps,
    // The coverage judgement alone over the merged report: the fast and lint jobs already ran every other rule of the app check.
    ciCoverageProof: exampleCommand(source, 'npx starci app coverage verify ' + lcovReport),
    // An app with an entity list also checks its entities against the schema its migrations build, in the build job (a runner with Docker).
    ciDatabaseLint: exampleCommand(source, (source?.files ?? []).includes(ENTITY_LIST.slice('be/'.length)) ? 'npm run db:lint && npx starci app db drift' : 'npm run db:lint'),
    auditCommand: `npm audit${audit.omitDev ? ' --omit=dev' : ''} --audit-level=${audit.level}`,
    sonarTokenSecret: sonar?.token ?? 'SONAR_TOKEN',
    sonarHostVar: sonar?.hostVar ?? 'SONAR_HOST_URL',
    // One lint job per side (the lint matrix): with Sonar each side writes its own report, uploaded as sonar-lint-<side> and merged by the sonar job.
    // The typed lint reads the generated code and the types the root packages and the fe packages declare (their dist), so all are built first, the way the root
    // lint script does, on every side of the matrix: a side that imports a package it finds unbuilt reads it as any.
    ciLintInputs: lintInputs,
    ciVerifyShards: verifyShards(scopes),
    ciLintSteps: ['      - name: build the lint inputs', `        run: ${lintInputs}`, ...(sonar ? [
      '      - name: lint with Sonar import',
      `        run: ${exampleCommand(source, 'npx --no-install starci app check --gate lint --side ' + side + ' --out reports/lint.' + side + '.sonar.json')}`,
      '        env:',
      `          NODE_OPTIONS: ${settings.nodeOptions}`,
      `      - uses: ${UPLOAD_ARTIFACT}`,
      // Inside an if: expression the matrix value is an argument of format(), never a nested ${{ }} (actionlint: a nested expression makes the condition always true).
      "        if: always() && hashFiles(format('reports/lint.{0}.sonar.json', matrix.side)) != ''",
      '        with:',
      `          name: sonar-lint-${side}`,
      `          path: reports/lint.${side}.sonar.json`,
    ] : [
      '      - name: lint',
      `        run: ${exampleCommand(source, 'npx --no-install starci app check --gate lint --side ' + side)}`,
      '        env:',
      `          NODE_OPTIONS: ${settings.nodeOptions}`,
    ])].join('\n'),
    codecovSteps: codecovSteps(lcovReport, codecov),
    verdictSonarNeed: sonar ? ', sonar' : '',
    verdictSonarCheck: sonar ? `\n          if [[ "$CHECKS" == true && ( "$FULL" == true || "$SONAR" == report ) ]]; then expect sonar success; else expect sonar idle; fi` : '',
    sonarJob: sonarJob(sonar, lcovReport, lcovArtifact, nodeMajor, settings.timeoutSonar as string, scopes, rootPackages),
    lcovArtifact,
  };
}
