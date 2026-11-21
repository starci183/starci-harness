// The Swarm deploy images an app declares, as the managed stack-deploy.yml workflow needs them.
//
// The workflow builds one image per `deploy.images` entry of .starcistacks/application-stacks.yaml and hands the pinned references to
// `starci app stack deploy`. Sync renders that list into the workflow, so it reads the declaration here: the union over the declared
// environments of `environments.<env>.deploy.images` (service -> { app, buildArgs }). Only names and the presence of build arguments are
// read; the real validation of the block is stack-deploy-config.mts (`starci app check`, rule R294). Everything this module returns is
// pure text assembled from names that match the strict patterns below, so no free text reaches the rendered workflow.
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml as bundledParseYaml } from '../runtime/engine/yaml.mjs';
import { DECLARATION } from './sonar-key.mjs';
import { buildTimeArgs } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
import { byCodeUnit } from '../report/order.mjs';
import { declaredBasePort, declaredGalleryHosts } from '../runtime/scripts/hfs/gallery.mjs';
import { REMOTE_BUILDER, RUNNER_FALLBACK } from '../stack/remote-builder.mjs';

const NAME = /^[a-z][a-z0-9-]*$/u;
const KEY = /^[A-Z][A-Z0-9_]*$/u;
const INDENT = ' '.repeat(6);
const CONTINUE = '\\';
const NO_IMAGES_MESSAGE = 'no image is declared: declare environments.<env>.deploy (with images) in .starcistacks/application-stacks.yaml before running this workflow';

// reason: the stack declaration is YAML parsed from disk; every field is checked by `record` and the NAME/KEY patterns before it is used
type Declaration = any;
type ParseYaml = (text: string) => Declaration;

/** One image of the declaration: the service, its app, whether it carries build arguments and whether those open a sealed member. */
export interface StackImage { service: string; app: string; buildArgs: boolean; sealed?: boolean }
/** One environment that deploys: the deploy.auto, deploy.approval and deploy.platforms keys of its deploy block. */
export interface DeployEnvironment { name: string; auto: boolean; approval: 'none' | 'reviewers'; platforms: string[] }
/** What the managed workflows render from the declaration. `environments` are the deploying ones in declared order; `imageCache` is ci.imageCache. */
export interface DeclaredStack { images: StackImage[]; passEnv: string[]; imageEnvironments?: Record<string, string[]>; environments?: DeployEnvironment[]; imageCache?: 'gha' | 'registry'; /** ci.imageBuilder: `remote` builds through the server's rootless BuildKit (falling back to the runner), `runner` (default) on the runner alone. */ imageBuilder?: ImageBuilder; /** `local.basePort` of the dev environment (R389); null when none is declared. */ basePort?: number | null; /** The public hosts `local.tunnel.routes[]` named `gallery` declare (PROJECT-GALLERY-1 item 4); empty when none. */ galleryHosts?: string[] }

/** Where the images job builds: on the hosted runner (default) or through the remote BuildKit of a managed VPS, with the runner as fallback. */
export type ImageBuilder = 'runner' | 'remote';

const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value); // reason: a YAML mapping
const hasBuildArgs = (args: unknown): boolean => record(args) && (Object.keys(record(args.values) ? args.values : {}).length > 0 || record(args.sealed));
const PLATFORM = /^linux\/(?:amd64|arm64)$/u;
const DEFAULT_PLATFORMS = ['linux/amd64'];

/** One image per sha: an image with `runtimePublicEnv: true` builds without its NEXT_PUBLIC_* values (the deploy passes them at runtime). */
function buildTimeFlags(entry: Declaration): { buildArgs: boolean; sealed: boolean } {
  const args: unknown = buildTimeArgs(entry);
  return { buildArgs: hasBuildArgs(args), sealed: record(args) && record(args.sealed) };
}

function environmentImages(environment: Declaration): StackImage[] {
  const images = environment?.deploy?.images;
  if (!record(images)) return [];
  return Object.entries(images)
    .filter(([service, entry]) => NAME.test(service) && record(entry) && NAME.test(String(entry.app)))
    .map(([service, entry]) => ({ service, app: entry.app, ...buildTimeFlags(entry) }));
}

/**
 * The images of a parsed declaration, [{ service, app, buildArgs }] sorted by service: the union over its environments (the first
 * environment that names a service decides its app; a later one only adds build arguments). A declaration with no deploy block has none.
 */
function declaredStackImages(declaration: Declaration): StackImage[] {
  const byService = new Map<string, StackImage>();
  for (const environment of Object.values(record(declaration?.environments) ? declaration.environments : {})) {
    for (const image of environmentImages(environment)) {
      const known = byService.get(image.service);
      byService.set(image.service, known ? { ...known, buildArgs: known.buildArgs || image.buildArgs, sealed: Boolean(known.sealed || image.sealed) } : image);
    }
  }
  return [...byService.values()].sort((a, b) => byCodeUnit(a.service, b.service));
}

/** The host variables (names only) the declared environments interpolate into `docker stack config`: the union of `deploy.passEnv`. */
function declaredPassEnv(declaration: Declaration): string[] {
  const names = (Object.values(record(declaration?.environments) ? declaration.environments : {}) as Declaration[])
    .flatMap(environment => (Array.isArray(environment?.deploy?.passEnv) ? environment.deploy.passEnv : []))
    .filter((name: unknown): name is string => typeof name === 'string' && KEY.test(name));
  return [...new Set<string>(names)].sort(byCodeUnit);
}

/** Release builds select the sole image environment, or production when several environments deploy images. */
function imageEnvironments(declaration: Declaration): Record<string, string[]> {
  return Object.fromEntries(Object.entries(declaration?.environments ?? {})
    .filter(([name, environment]) => NAME.test(name) && environmentImages(environment).length > 0)
    .map(([name, environment]) => [name, environmentImages(environment).map(image => image.app)]));
}

/** The environments that carry a deploy block, in declared order, with the auto, approval and platforms keys (defaults: manual, no reviewers, linux/amd64). */
function deployEnvironments(declaration: Declaration): DeployEnvironment[] {
  return Object.entries(record(declaration?.environments) ? declaration.environments : {})
    .filter(([name, environment]) => NAME.test(name) && record((environment as Declaration)?.deploy))
    .map(([name, environment]) => {
      const deploy = (environment as Declaration).deploy;
      const platforms = Array.isArray(deploy.platforms) ? deploy.platforms.filter((value: unknown): value is string => typeof value === 'string' && PLATFORM.test(value)) : [];
      return { name, auto: deploy.auto === true, approval: deploy.approval === 'reviewers' ? 'reviewers' : 'none', platforms: platforms.length ? platforms : DEFAULT_PLATFORMS } as DeployEnvironment;
    });
}

/**
 * What the managed workflows render from the declaration at `root`: { images, passEnv, imageEnvironments } (empty when the app has no
 * declaration, no deploy block or a declaration that does not parse; `starci app check` judges those). `parseYaml(text)` is injected.
 */
export function readDeclaredStack(root: string, { parseYaml = bundledParseYaml as ParseYaml }: { parseYaml?: ParseYaml | undefined } = {}): DeclaredStack {
  const file = path.join(root, DECLARATION);
  if (!fs.existsSync(file)) return { images: [], passEnv: [] };
  let declaration: Declaration;
  try {
    declaration = parseYaml(fs.readFileSync(file, 'utf8'));
  } catch {
    return { images: [], passEnv: [] };
  }
  return declaredStack(declaration);
}

/** Parsed declarations share the exact image, environment and pass-env projection used by sync. */
export function declaredStack(declaration: Declaration): DeclaredStack {
  const cache = declaration?.ci?.imageCache;
  return { images: declaredStackImages(declaration), passEnv: declaredPassEnv(declaration), imageEnvironments: imageEnvironments(declaration), environments: deployEnvironments(declaration), imageCache: cache === 'registry' ? 'registry' : 'gha', imageBuilder: declaration?.ci?.imageBuilder === 'remote' ? 'remote' : 'runner', basePort: declaredBasePort(declaration), galleryHosts: declaredGalleryHosts(declaration) };
}

const envName = (service: string): string => `IMAGE_${service.toUpperCase().replaceAll('-', '_')}`;
/** Lines placed at the end of a template line: each one starts with a newline, so nothing declared leaves nothing, not even a blank line. */
const block = (items: readonly string[], indent = INDENT): string => items.map(item => `\n${indent}${item}`).join('');
/** Lines of a block placed on a line of their own, each indented (an empty list is the empty string). */
const lines = (items: readonly string[], indent: string): string => items.map(item => (item === '' ? '' : `${indent}${item}`)).join('\n');

const CHECKOUT = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0';
const SETUP_NODE = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0';
const SETUP_BUILDX = 'docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f # v3.12.0';
const SETUP_QEMU = 'docker/setup-qemu-action@29109295f81e9208d7d86ff1c6c12d2833863392 # v3.6.0';
const DOCKER_LOGIN = 'docker/login-action@184bdaa0721073962dff0199f1fb9940f07167d1 # v3.5.0';
const BUILD_PUSH = 'docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6.19.2';
const INSTALL_SOPS = 'mdgreenwald/mozilla-sops-action@bb2d96a13ef438ad122e5827a57ebd75d6ff118d # v2.1.0';
const TAG_MATCHES_VERSION = 'node -e "const version=require(\'./package.json\').version;if(process.env.GITHUB_REF_NAME!==\'v\'+version)process.exit(1)"';

/** An app the images workflow builds: its Dockerfile. */
export interface ImageApp { name: string; file: string }
/** What the image jobs of one app need: deployed (some deploy.images entry builds from it), args (build values), sealed (they open a sealed member). */
interface ImagePlan extends ImageApp { deployed: boolean; args: boolean; sealed: boolean; services: string[] }

/**
 * Which of the app's images need build values, and from where. The values of the release environment (the sole image environment, or production
 * when several deploy images) are the ones an image is built with; an app that environment does not deploy keeps its Dockerfile defaults.
 */
function imagePlans(apps: readonly ImageApp[], { images, imageEnvironments: environments = {} }: DeclaredStack): ImagePlan[] {
  const selected = new Set(environments[releaseEnvironment(environments)] ?? []);
  return apps.map((app) => {
    const own = images.filter(image => image.app === app.name);
    const args = selected.has(app.name) && own.some(image => image.buildArgs);
    return { ...app, deployed: own.length > 0, args, sealed: args && own.some(image => image.sealed === true), services: own.map(image => image.service) };
  });
}

const matrixEntries = (plans: readonly ImagePlan[]): string[] => plans.flatMap(plan => [`- name: ${plan.name}`, `  file: ${plan.file}`, `  deployed: ${plan.deployed}`, `  args: ${plan.args}`]);

/** The platforms every deploying environment needs, the union in a stable order (default linux/amd64: the VPS's architecture). */
function platformsOf(environments: readonly DeployEnvironment[]): string[] {
  const all = new Set(environments.flatMap(environment => environment.platforms));
  return all.size ? [...all].sort(byCodeUnit) : DEFAULT_PLATFORMS;
}

function imageCacheLines(cache: 'gha' | 'registry'): string[] {
  if (cache === 'registry') return [
    'cache-from: type=registry,ref=${{ steps.names.outputs.repo }}:buildcache',
    "cache-to: ${{ inputs.push && format('type=registry,ref={0}:buildcache,mode=max', steps.names.outputs.repo) || '' }}",
  ];
  return ['cache-from: type=gha,scope=${{ matrix.name }}', 'cache-to: type=gha,scope=${{ matrix.name }},mode=max'];
}

interface ImageJobOptions { project: string; nodeMajor: string; environment: string; platforms: readonly string[]; cache: 'gha' | 'registry'; remote: boolean }


/**
 * The step that tries the remote builder: the per-repository key and the pinned known_hosts from the repository secrets, an ssh alias, then
 * `docker buildx create --driver remote ssh://starci-build@<alias>` and a bootstrap under a timeout (a real `buildctl dial-stdio` through the
 * server's gate). Any failure removes the builder, prints RUNNER_FALLBACK with the reason and leaves `remote=false`, so the runner's builder
 * builds instead. Nothing it prints names the host.
 */
function remoteBuilderSteps(): string[] {
  const { user, builder, alias, bootstrapSeconds } = REMOTE_BUILDER;
  return [
    '- name: remote builder',
    '  id: builder',
    '  shell: bash',
    '  env:',
    '    BUILDER_KEY: ${{ secrets.STARCI_BUILDER_SSH_KEY }}',
    '    BUILDER_HOST: ${{ secrets.STARCI_BUILDER_HOST }}',
    '    BUILDER_KNOWN_HOSTS: ${{ secrets.STARCI_BUILDER_KNOWN_HOSTS }}',
    '  run: |',
    '    set +e -uo pipefail',
    // No -e: every failure below ends in runner(), which removes a half-made builder and hands the build to the runner's own builder.
    `    runner() { echo "::notice::${RUNNER_FALLBACK} ($1)"; docker buildx rm ${builder} >/dev/null 2>&1; echo "remote=false" >> "$GITHUB_OUTPUT"; exit 0; }`,
    '    [[ -n "$BUILDER_KEY" && -n "$BUILDER_HOST" && -n "$BUILDER_KNOWN_HOSTS" ]] || runner "the builder secrets are not set"',
    '    host="${BUILDER_HOST%:*}"; port=22; if [[ "$BUILDER_HOST" == *:* ]]; then port="${BUILDER_HOST##*:}"; fi',
    '    install -d -m 700 ~/.ssh',
    `    printf '%s\\n' "$BUILDER_KEY" > ~/.ssh/${alias} && chmod 600 ~/.ssh/${alias}`,
    `    printf '%s\\n' "$BUILDER_KNOWN_HOSTS" >> ~/.ssh/known_hosts`,
    `    printf 'Host ${alias}\\n  HostName %s\\n  Port %s\\n  User ${user}\\n  IdentityFile ~/.ssh/${alias}\\n  IdentitiesOnly yes\\n  StrictHostKeyChecking yes\\n  BatchMode yes\\n  ConnectTimeout 10\\n' "$host" "$port" >> ~/.ssh/config`,
    `    docker buildx create --name ${builder} --driver remote --use ssh://${user}@${alias} >/dev/null 2>&1 || runner "docker buildx create failed"`,
    `    timeout ${bootstrapSeconds} docker buildx inspect --bootstrap ${builder} >/dev/null 2>&1 || runner "no answer within ${bootstrapSeconds} s"`,
    `    echo "building through the remote builder ${builder}"`,
    '    echo "remote=true" >> "$GITHUB_OUTPUT"',
  ];
}

/** The last step when the remote builder was tried: the builder and the key go, whatever the build did. */
function remoteBuilderCleanup(): string[] {
  return [
    '- name: remove the remote builder',
    "  if: ${{ always() && steps.builder.outputs.remote == 'true' }}",
    '  shell: bash',
    `  run: if docker buildx inspect ${REMOTE_BUILDER.builder} >/dev/null 2>&1; then docker buildx rm ${REMOTE_BUILDER.builder}; fi; rm -f ~/.ssh/${REMOTE_BUILDER.alias}`,
  ];
}

/** One build job of images.yml: `image` builds with public values and no environment, `image-sealed` opens the sealed build values of the release environment. */
function imageJob(id: 'image' | 'image-sealed', plans: readonly ImagePlan[], { project, nodeMajor, environment, platforms, cache, remote }: ImageJobOptions): string {
  const sealed = id === 'image-sealed';
  const qemu = platforms.some(platform => platform !== 'linux/amd64');
  const head = [
    `${id}:`,
    '  timeout-minutes: 30',
    '  runs-on: ubuntu-latest',
    ...(sealed ? ['  if: ${{ inputs.release }}', `  environment: ${environment}`] : []),
    '  permissions:', '    contents: read', '    packages: write',
    '  strategy:', '    fail-fast: false', '    matrix:', '      include:',
    ...matrixEntries(plans).map(line => `        ${line}`),
    '  steps:',
  ];
  const steps = [
    `- uses: ${CHECKOUT}`,
    '- name: release tag matches package version',
    '  if: ${{ inputs.release }}',
    '  shell: bash',
    '  run: |',
    '    [[ "$GITHUB_REF" == refs/tags/v* ]] || exit 1',
    `    ${TAG_MATCHES_VERSION}`,
    '- name: image repository',
    '  id: names',
    '  shell: bash',
    '  run: |',
    '    owner="${GITHUB_REPOSITORY_OWNER,,}"',
    `    echo "repo=ghcr.io/\${owner}/${project}-\${{ matrix.name }}" >> "$GITHUB_OUTPUT"`,
    ...(qemu ? [`- uses: ${SETUP_QEMU}`] : []),
    ...(remote ? [...remoteBuilderSteps(), `- uses: ${SETUP_BUILDX}`, "  if: ${{ steps.builder.outputs.remote != 'true' }}"] : [`- uses: ${SETUP_BUILDX}`]),
    `- uses: ${DOCKER_LOGIN}`,
    '  if: ${{ inputs.push }}',
    '  with:', '    registry: ghcr.io', '    username: ${{ github.actor }}', '    password: ${{ github.token }}',
    `- uses: ${SETUP_NODE}`,
    '  if: ${{ matrix.args }}',
    '  with:', `    node-version: ${nodeMajor}`, '    cache: npm',
    '- run: npm ci --ignore-scripts',
    '  if: ${{ matrix.args }}',
    ...(sealed ? ['- name: install SOPS', '  if: ${{ matrix.args }}', `  uses: ${INSTALL_SOPS}`, '  with:', '    version: v3.13.2'] : []),
    '- name: public build values',
    '  id: args',
    '  if: ${{ matrix.args }}',
    '  env:',
    ...(sealed ? ['    SOPS_AGE_KEY: ${{ secrets.SOPS_AGE_KEY }}'] : []),
    '    IMAGE_APP: ${{ matrix.name }}',
    `  run: npx --no-install starci app stack build-args --env ${environment} --app "$IMAGE_APP"`,
    `- uses: ${BUILD_PUSH}`,
    '  with:',
    '    context: .',
    '    file: ${{ matrix.file }}',
    '    build-args: ${{ steps.args.outputs.args }}',
    `    platforms: ${platforms.join(',')}`,
    '    push: ${{ inputs.push && matrix.deployed }}',
    // Immutable and per commit; the release name v<version> is added below without a rebuild, so the digest the checks proved is the one that ships.
    '    tags: ${{ steps.names.outputs.repo }}:sha-${{ github.sha }}',
    // The SBOM and the provenance are attached to the pushed digest (OCI attestations); a build that is not pushed is only a proof that the Dockerfile builds.
    '    sbom: true',
    '    provenance: mode=max',
    ...imageCacheLines(cache).map(line => `    ${line}`),
    '- name: tag the release',
    '  if: ${{ inputs.release && inputs.push && matrix.deployed }}',
    '  shell: bash',
    '  env:',
    '    REPO: ${{ steps.names.outputs.repo }}',
    '  run: docker buildx imagetools create --tag "$REPO:$GITHUB_REF_NAME" "$REPO:sha-$GITHUB_SHA"',
    ...(remote ? remoteBuilderCleanup() : []),
  ];
  return lines([...head, ...steps.map(step => `    ${step}`)], '  ');
}

/** The collect job: the digests this run pushed under sha-<sha>, as the JSON the deploy takes. The images of sealed build values exist only on a release run. */
function collectJob(plans: readonly ImagePlan[], jobs: readonly string[], project: string): string {
  const waits = jobs.map(job => (job === 'image' ? "needs.image.result == 'success'" : "(needs.image-sealed.result == 'success' || needs.image-sealed.result == 'skipped')"));
  const list = plans.filter(plan => plan.deployed).flatMap(plan => plan.services.map(service => `${service} ${plan.name} ${plan.sealed}`));
  return lines([
    'collect:',
    `  needs: [${jobs.join(', ')}]`,
    `  if: \${{ !cancelled() && inputs.push && ${waits.join(' && ')} }}`,
    '  timeout-minutes: 10',
    '  runs-on: ubuntu-latest',
    '  permissions:', '    contents: read', '    packages: read',
    '  outputs:', '    refs: ${{ steps.refs.outputs.refs }}',
    '  steps:',
    `    - uses: ${SETUP_BUILDX}`,
    `    - uses: ${DOCKER_LOGIN}`,
    '      with:', '        registry: ghcr.io', '        username: ${{ github.actor }}', '        password: ${{ github.token }}',
    '    - name: pushed digests',
    '      id: refs',
    '      shell: bash',
    '      env:', '        RELEASE: ${{ inputs.release }}',
    '      run: |',
    '        set -euo pipefail',
    '        owner="${GITHUB_REPOSITORY_OWNER,,}"',
    "        refs='{}'",
    '        while read -r service app sealed; do',
    '          if [[ "$sealed" == true && "$RELEASE" != true ]]; then continue; fi',
    `          repo="ghcr.io/\${owner}/${project}-\${app}"`,
    "          digest=$(docker buildx imagetools inspect \"$repo:sha-$GITHUB_SHA\" --format '{{json .Manifest}}' | jq -r .digest)",
    '          [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "::error::no pushed digest for the image of ${service}"; exit 1; }',
    "          refs=$(jq -c --arg service \"$service\" --arg ref \"$repo@$digest\" '. + {($service): $ref}' <<<\"$refs\")",
    "        done <<'LIST'",
    ...list.map(entry => `        ${entry}`),
    '        LIST',
    '        echo "refs=$refs" >> "$GITHUB_OUTPUT"',
  ], '  ');
}

/**
 * The text blocks of images.yml, the reusable workflow ci.yml calls. imageJobs holds the build jobs (public values; sealed values bound to the
 * release environment, release runs only) and the collect job when an image is deployed; imageWorkflowOutputs the `refs` output of the call.
 */
function imageWorkflowVariables(stack: DeclaredStack, project: string, apps: readonly ImageApp[], nodeMajor: string, environment: string): Record<string, string> {
  const plans = imagePlans(apps, stack);
  const publicPlans = plans.filter(plan => !plan.sealed);
  const sealedPlans = plans.filter(plan => plan.sealed);
  const platforms = platformsOf(stack.environments ?? []);
  // The remote builder is the server's own architecture, amd64; a multi-architecture build stays on the runner with QEMU.
  const remote = stack.imageBuilder === 'remote' && platforms.every(platform => platform === 'linux/amd64');
  const options: ImageJobOptions = { project, nodeMajor, environment, platforms, cache: stack.imageCache ?? 'gha', remote };
  const jobs = [...(publicPlans.length ? ['image'] : []), ...(sealedPlans.length ? ['image-sealed'] : [])];
  const collect = plans.some(plan => plan.deployed) && jobs.length > 0;
  return {
    imageJobs: [
      ...(publicPlans.length ? [imageJob('image', publicPlans, options)] : []),
      ...(sealedPlans.length ? [imageJob('image-sealed', sealedPlans, options)] : []),
      ...(collect ? [collectJob(plans, jobs, project)] : []),
    ].join('\n\n'),
    imageWorkflowOutputs: collect ? lines(['outputs:', '  refs:', '    description: JSON object, service -> repository@sha256:digest of the images this run pushed', '    value: ${{ jobs.collect.outputs.refs }}'], '    ') : '',
    // The builder secrets reach the reusable workflow by inheritance: declaring them under workflow_call.secrets would hide the release
    // environment's own SOPS_AGE_KEY from the sealed job's expressions.
    ciImageSecrets: remote && jobs.length > 0 ? block(['secrets: inherit'], '    ') : '',
    imagesCollected: collect ? 'true' : '',
  };
}

/** The deploy jobs of ci.yml: one call of the reusable stack-deploy.yml per environment with deploy.auto, in declared order, each after the one before it. */
function ciDeployVariables(stack: DeclaredStack, collected: boolean): Record<string, string> {
  const auto = (stack.environments ?? []).filter(environment => environment.auto);
  const jobs = auto.map((environment, index) => {
    const before = index > 0 ? `deploy-${auto[index - 1]!.name}` : '';
    const previous = before ? `, ${before}` : '';
    // A skipped need skips its dependents through the whole chain, even past the verdict's always(): a gate switched off (lint, test, coverage
    // left out on purpose) silently cancelled the release deploy. So the deploy runs on its own status check and names every result it needs:
    // the verdict green (it judged the gates, the off ones included), the images pushed, the environment before it deployed.
    const results = ['verdict', ...(collected ? ['images'] : []), ...(before ? [before] : [])].map(job => ` && needs.${job}.result == 'success'`).join('');
    return lines([
      `deploy-${environment.name}:`,
      `  needs: [plan, verdict${collected ? ', images' : ''}${previous}]`,
      `  if: \${{ !cancelled() && needs.plan.outputs.release == 'true'${results} }}`,
      '  permissions:', '    contents: read', '    packages: read', '    actions: read',
      '  concurrency:', `    group: deploy-${environment.name}`, '    cancel-in-progress: false',
      '  uses: ./.github/workflows/stack-deploy.yml',
      '  with:',
      `    environment: ${environment.name}`,
      '    operation: deploy',
      '    auto: true',
      ...(collected ? ['    images: ${{ needs.images.outputs.refs }}'] : []),
      '    ci_run: ${{ needs.plan.outputs.ci_run }}',
    ], '  ');
  });
  return { ciDeployJobs: jobs.length ? `\n${jobs.join('\n\n')}\n` : '' };
}

/** The release environment: the sole image environment, or production when several deploy images. */
function releaseEnvironment(environments: Record<string, string[]>): string {
  const names = Object.keys(environments);
  return names.length > 1 ? 'production' : names[0] ?? 'production';
}

/**
 * The text blocks the managed workflows place at the end of a line or on a line of their own (empty when there is nothing to place):
 *   stackGuard       the first step of the deploy job when the app declares no image (it fails with the reason)
 *   stackImageList   the `<service> <app>` lines the image step of stack-deploy.yml reads (the registry holds sha-<sha> of each)
 *   stackImageEnv    the env entries of the deploy step: IMAGE_<SERVICE> = repository@digest, from the image step
 *   stackImageArgs   the `--image "<service>=$IMAGE_<SERVICE>" \` continuation lines of the deploy command
 *   stackPassEnv     the env entries of the deploy step for the declared host variables (vars.<NAME>)
 *   imageJobs, imageWorkflowOutputs   the build and collect jobs and the output of images.yml
 *   ciImageSecrets   with ci.imageBuilder remote: `secrets: inherit` on the images call of ci.yml, so images.yml reads the builder secrets
 *   ciDeployJobs     the deploy jobs of ci.yml (one per environment with deploy.auto)
 * `apps` are the apps images.yml builds, each with its Dockerfile (the sync module knows the layout).
 */
export function stackWorkflowVariables({ images = [], passEnv = [], imageEnvironments: environments = {}, environments: deploying = [], imageCache = 'gha', imageBuilder = 'runner' }: DeclaredStack, project: string, apps: readonly ImageApp[] = [], nodeMajor = '22'): Record<string, string> {
  const guard = images.length ? '' : block([
    '- name: require a declared image',
    '  shell: bash',
    `  run: 'echo "::error::${NO_IMAGES_MESSAGE}"; exit 1'`,
  ]);
  const stack: DeclaredStack = { images, passEnv, imageEnvironments: environments, environments: deploying, imageCache, imageBuilder };
  const image = imageWorkflowVariables(stack, project, apps, nodeMajor, releaseEnvironment(environments));
  return {
    imageEnvironment: releaseEnvironment(environments),
    ...image,
    ...ciDeployVariables(stack, image.imagesCollected === 'true'),
    stackGuard: guard,
    stackImageList: images.map(entry => `${entry.service} ${entry.app}`).join('\n          '),
    stackImageEnv: block(images.map(entry => `${envName(entry.service)}: \${{ steps.images.outputs.${entry.service} }}`), ' '.repeat(10)),
    stackImageArgs: block(images.map(entry => `--image "${entry.service}=$${envName(entry.service)}" ${CONTINUE}`), ' '.repeat(12)),
    stackPassEnv: block(passEnv.map(name => `${name}: \${{ vars.${name} }}`), ' '.repeat(10)),
  };
}
