// build.mts - `starci app stack build --env <env> [--push] [--execute]`: builds, from the CURRENT checkout, every image the deploy block declares
// (docker buildx, linux/amd64, no provenance so the digest is one manifest), passing the public build values of build-args.mts, and prints
// `--image <service>=<registry/name@sha256:digest>` lines ready for `stack deploy`. It refuses a dirty tree and a HEAD that carries no release tag
// (the images must come from the released commit). It never reads registry credentials: pushing uses the operator's own `docker login`.
// The image name is `<registry host>/<owner>/<project>-<app>:<full sha>`, the owner being the GitHub owner of `origin` (ghcr.io only).
// With --builder-host <host> (or STARCI_BUILDER_HOST) the images build through the remote rootless BuildKit of that managed VPS (the buildx builder
// `starci-remote`, driver remote, ssh://starci-build@<host>): `--load` brings each image back over the connection, `--push` goes from the builder to the
// registry with the operator's own docker credentials forwarded per build, so nothing is stored on the server. <host> is an ssh destination this machine
// reaches with its own key (an ~/.ssh/config alias, or host[:port]); the host roles' config.yaml lookup resolves a machine name to it (the seam).
// With deploy.registry.visibility `public` (the default) every image is scanned for secret material BEFORE it is pushed (image-scan.mts: the layers of
// a public package are public), and after the push the real visibility of the package is checked with an ANONYMOUS manifest fetch of the pushed
// digest; a package that is still private is reported with the one owner step that changes it (GitHub has no API for that) and the run fails.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildArgs } from './build-args.mjs';
import type { DeployConfig } from './config.mjs';
import { firstLine, lines as splitLines, tool } from './context.mjs';
import type { RunResult, StackContext } from './context.mjs';
import { failure, refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import { requireAgeIdentity } from './sealed.mjs';
import { buildTimeArgs } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
import { scanImage } from './image-scan.mjs';
import type { ImageScan } from './image-scan.mjs';
import { REMOTE_BUILDER } from './remote-builder.mjs';

/** One image to build. */
interface PlanItem { service: string; app: string; dockerfile: string; ref: string; hasBuildArgs: boolean }
/** The build values of one image as `[KEY, value]` pairs. */
type BuildArgPairs = [string, string][];
/** The outcome of building (and maybe pushing) one image. */
interface ImageOutcome { ok: boolean; digest?: string | null; lines: string[] }

const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const GITHUB_REMOTE = /github\.com[:/]([A-Za-z0-9._-]+)\/[A-Za-z0-9._-]+?(?:\.git)?$/u;
const BUILD_ARG = /^([A-Z][A-Z0-9_]*)=(.*)$/u;
/** An ssh destination for the remote builder: an alias or a host name or address, with an optional port. */
const BUILDER_HOST = /^[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]{1,5})?$/u;

const SIDES = ['be', 'fe'];
const MAX_HITS_SHOWN = 20;
const MANIFEST_TYPES = ['application/vnd.oci.image.index.v1+json', 'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json', 'application/vnd.docker.distribution.manifest.v2+json'];

const git = (ctx: StackContext, config: DeployConfig, args: string[]): RunResult => tool(ctx, 'git', args, { cwd: config.repoRoot });

/** The release facts of the checkout: { sha, tag } or a refusal (dirty tree, no release tag). */
function checkout(ctx: StackContext, config: DeployConfig): { sha: string; tag: string } {
  const status = git(ctx, config, ['status', '--porcelain']);
  if (status.status !== 0) throw failure('STACK_BUILD_GIT', `git status failed: ${firstLine(status.stderr)}`);
  const dirty = splitLines(status.stdout);
  if (dirty.length > 0) throw refusal('STACK_BUILD_DIRTY', `the working tree is not clean (${dirty.length} path(s), first: ${dirty[0]}): images must come from the released commit`);
  const sha = splitLines(git(ctx, config, ['rev-parse', 'HEAD']).stdout)[0] ?? '';
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw failure('STACK_BUILD_GIT', 'cannot read HEAD');
  const tag = splitLines(git(ctx, config, ['tag', '--points-at', 'HEAD']).stdout).find((name) => RELEASE_TAG.test(name));
  if (!tag) throw refusal('STACK_BUILD_UNTAGGED', 'HEAD carries no release tag (vMAJOR.MINOR.PATCH): build only the released commit');
  return { sha, tag };
}

function ownerOf(ctx: StackContext, config: DeployConfig): string {
  const remote = git(ctx, config, ['remote', 'get-url', 'origin']);
  const match = GITHUB_REMOTE.exec(firstLine(remote.stdout));
  if (remote.status !== 0 || !match) throw refusal('STACK_BUILD_OWNER', 'origin is not a github.com remote: the image owner cannot be derived');
  return (match[1] as string).toLowerCase();
}

/** The managed Dockerfile of an app that keeps its image with the stacks (.starcistacks/images/<app>/Dockerfile: the db and the storage image). */
const imageFolderDockerfile = (app: string): string => `.starcistacks/images/${app}/Dockerfile`;

/**
 * The Dockerfile of an app: .starcistacks/images/<app>/Dockerfile when the stacks keep one (the managed db and storage images; the build context stays the app root,
 * and a Dockerfile-specific ignore file beside it narrows it), else be/apps/<app>/Dockerfile or fe/apps/<app>/Dockerfile; ambiguity and absence are refusals.
 */
export function dockerfileOf(config: DeployConfig, app: string): string {
  if (/^[a-z][a-z0-9-]*$/u.test(app) && fs.existsSync(path.join(config.repoRoot, imageFolderDockerfile(app)))) return imageFolderDockerfile(app);
  const found = SIDES.map((side) => `${side}/apps/${app}/Dockerfile`).filter((file) => fs.existsSync(path.join(config.repoRoot, file)));
  if (found.length === 0) throw refusal('STACK_BUILD_NO_DOCKERFILE', `no Dockerfile for app ${app} (be/apps/${app}/Dockerfile or fe/apps/${app}/Dockerfile)`);
  if (found.length > 1) throw refusal('STACK_BUILD_AMBIGUOUS', `app ${app} has a Dockerfile on both sides: ${found.join(', ')}`);
  return found[0] as string;
}

async function argsOf(ctx: StackContext, config: DeployConfig, app: string, hasBuildArgs: boolean): Promise<BuildArgPairs> {
  if (!hasBuildArgs) return [];
  const result = await buildArgs(ctx, config, { app });
  return result.lines.map((line) => BUILD_ARG.exec(line)).filter((match): match is RegExpExecArray => match !== null).map((match): [string, string] => [match[1] as string, match[2] as string]);
}

/** Whether the image is built with any value (`runtimePublicEnv: true` leaves its NEXT_PUBLIC_* keys to the runtime). */
const hasBuildTimeArgs = (entry: DeployConfig['images'][string]): boolean => { const args = buildTimeArgs(entry); return Object.keys(args.values).length > 0 || args.sealed !== null; };

function plan(config: DeployConfig, { sha, owner }: { sha: string; owner: string }): PlanItem[] {
  return Object.entries(config.images).map(([service, entry]) => ({
    service,
    app: entry.app,
    dockerfile: dockerfileOf(config, entry.app),
    ref: `${config.registry.host}/${owner}/${config.project}-${entry.app}:${sha}`,
    hasBuildArgs: hasBuildTimeArgs(entry),
  }));
}

/** The buildx endpoint of the remote builder on `host` (`host` or `host:port`). */
export function remoteBuilderEndpoint(host: string): string {
  if (!BUILDER_HOST.test(host)) throw refusal('STACK_BUILD_BUILDER_HOST', `--builder-host takes an ssh destination (an alias or a host, with an optional :port); ${host} is not one`);
  return `ssh://${REMOTE_BUILDER.user}@${host}`;
}

/**
 * Creates (or re-creates, when it points elsewhere) the local buildx builder `starci-remote` for `endpoint` and bootstraps it under a timeout: a real
 * `buildctl dial-stdio` through the server's gate. An unreachable builder is a refusal (the operator asked for it); nothing was built.
 */
export function ensureRemoteBuilder(ctx: StackContext, config: DeployConfig, endpoint: string): string {
  const name = REMOTE_BUILDER.builder;
  const bootstrapMs = REMOTE_BUILDER.bootstrapSeconds * 1000;
  const known = tool(ctx, 'docker', ['buildx', 'inspect', name], { cwd: config.repoRoot });
  const same = known.status === 0 && String(known.stdout).split(/\r?\n/u).some((line) => /^\s*Endpoint:\s*/u.test(line) && line.trim().endsWith(endpoint));
  if (known.status === 0 && !same) tool(ctx, 'docker', ['buildx', 'rm', name], { cwd: config.repoRoot });
  if (!same) {
    const created = tool(ctx, 'docker', ['buildx', 'create', '--name', name, '--driver', 'remote', endpoint], { cwd: config.repoRoot });
    if (created.status !== 0) throw refusal('STACK_BUILD_REMOTE_UNREACHABLE', `docker buildx create ${name} failed: ${firstLine(created.stderr) || 'refused'}; nothing was built`);
  }
  const boot = tool(ctx, 'docker', ['buildx', 'inspect', '--bootstrap', name], { cwd: config.repoRoot, timeout: bootstrapMs });
  if (boot.status !== 0) throw refusal('STACK_BUILD_REMOTE_UNREACHABLE', `the remote builder ${endpoint} did not answer (${firstLine(boot.stderr) || `no answer within ${bootstrapMs / 1000} s`}); nothing was built (drop --builder-host to build on this machine)`);
  return name;
}

function buildOne(ctx: StackContext, config: DeployConfig, item: PlanItem, args: BuildArgPairs, push: boolean, builder: string | null): { ok: false; error: string } | { ok: true; digest: string | null } {
  const metadata = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stack-build-')), 'metadata.json');
  const argv = ['buildx', 'build', ...(builder ? ['--builder', builder] : []), '--platform', 'linux/amd64', '--provenance=false', '--file', item.dockerfile, '--tag', item.ref, '--metadata-file', metadata,
    ...args.flatMap(([key, value]) => ['--build-arg', `${key}=${value}`]), push ? '--push' : '--load', '.'];
  const run = tool(ctx, 'docker', argv, { cwd: config.repoRoot });
  let digest: string | null = null;
  try { digest = JSON.parse(fs.readFileSync(metadata, 'utf8'))['containerimage.digest'] ?? null; } catch { digest = null; }
  fs.rmSync(path.dirname(metadata), { recursive: true, force: true });
  if (run.status !== 0) return { ok: false, error: firstLine(run.stderr) || 'docker buildx failed' };
  return { ok: true, digest };
}

/** `docker push` of a scanned local image; the digest is the one docker prints. */
function pushOne(ctx: StackContext, config: DeployConfig, item: PlanItem): { ok: false; error: string } | { ok: true; digest: string | null } {
  const run = tool(ctx, 'docker', ['push', item.ref], { cwd: config.repoRoot });
  if (run.status !== 0) return { ok: false, error: firstLine(run.stderr) || 'docker push failed' };
  return { ok: true, digest: /digest:\s*(sha256:[0-9a-f]{64})/u.exec(String(run.stdout))?.[1] ?? null };
}

function scanRefusal(item: PlanItem, scan: ImageScan): string[] {
  const shown = scan.hits.slice(0, MAX_HITS_SHOWN).map((hit) => `  ${hit.kind}: ${hit.where} (${hit.why})`);
  const more = scan.hits.length > MAX_HITS_SHOWN ? [`  ... and ${scan.hits.length - MAX_HITS_SHOWN} more`] : [];
  const head = `REFUSED to push ${item.service}: the image would be public and the scan found ${scan.hits.length} hit(s) and ${scan.errors.length} failed step(s) (places only, never the text)`;
  return [head, ...shown, ...more, ...scan.errors.map((error) => `  scan error: ${error}`)];
}

/** One image: built (and pushed in the same step when private); built, scanned and only then pushed when public. Returns { ok, digest, lines }. */
function processImage(ctx: StackContext, config: DeployConfig, item: PlanItem, args: BuildArgPairs, { push, builder }: { push: boolean; builder: string | null }): ImageOutcome {
  const isPublic = config.registry.visibility === 'public';
  const built = buildOne(ctx, config, item, args, push && !isPublic, builder);
  if (!built.ok) return { ok: false, lines: [`build of ${item.service} FAILED: ${built.error}`] };
  if (!isPublic) return { ok: true, digest: built.digest, lines: [] };
  const scan = scanImage(ctx, item.ref, { allowedArgs: args.map(([key]) => key) });
  if (!scan.ok) return { ok: false, lines: scanRefusal(item, scan) };
  const clean = `scanned ${item.service}: no secret material found`;
  if (!push) return { ok: true, digest: null, lines: [clean] };
  const pushed = pushOne(ctx, config, item);
  if (!pushed.ok) return { ok: false, lines: [clean, `push of ${item.service} FAILED: ${pushed.error}`] };
  return { ok: true, digest: pushed.digest, lines: [clean] };
}

const ownerStep = (name: string): string => `owner step: GitHub -> Packages -> ${name} -> Package settings -> Change visibility -> Public (GitHub has no API for this)`;

/** 'public' when an ANONYMOUS client can fetch the manifest of the pushed digest, 'private' when the registry refuses it, 'unknown' on a network error. */
async function visibilityOf(ctx: StackContext, host: string, repository: string, digest: string): Promise<string> {
  try {
    const token = await ctx.fetch(`https://${host}/token?scope=repository:${repository}:pull&service=${host}`, { signal: AbortSignal.timeout(15000) });
    const bearer = token.ok ? ((await token.json()) as { token?: string }).token : null; // reason: registry token response, parsed JSON
    const headers = { Accept: MANIFEST_TYPES.join(', '), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) };
    const manifest = await ctx.fetch(`https://${host}/v2/${repository}/manifests/${digest}`, { headers, signal: AbortSignal.timeout(15000) });
    return manifest.status === 200 ? 'public' : 'private';
  } catch {
    return 'unknown';
  }
}

/** After the push: the real visibility of every pushed package against the declared one. Returns { ok, lines, actual }. */
async function checkVisibility(ctx: StackContext, config: DeployConfig, images: Record<string, string>): Promise<{ ok: boolean; lines: string[]; actual: Record<string, string> }> {
  const declared = config.registry.visibility;
  const lines: string[] = [];
  const actual: Record<string, string> = {};
  let ok = true;
  for (const [service, ref] of Object.entries(images)) {
    const [name, digest] = ref.split('@') as [string, string];
    const repository = name.slice(config.registry.host.length + 1);
    const packageName = repository.slice(repository.indexOf('/') + 1);
    const seen = await visibilityOf(ctx, config.registry.host, repository, digest);
    actual[service] = seen;
    if (seen === 'unknown') lines.push(`visibility of ${packageName} could not be checked (network)`);
    else if (seen === declared) lines.push(`visibility of ${packageName}: ${seen}, as declared`);
    else if (declared === 'public') {
      ok = false;
      lines.push(`visibility of ${packageName} is PRIVATE but deploy.registry.visibility is public`, ownerStep(packageName));
    } else lines.push(`note: ${packageName} is public although deploy.registry.visibility is private; change it in Package settings or declare public`);
  }
  return { ok, lines, actual };
}

/** `build`: dry run unless execute; pushing needs --push as well. */
export async function buildImages(ctx: StackContext, config: DeployConfig, { push = false, execute = false, builderHost }: { push?: boolean; execute?: boolean; builderHost?: string | undefined } = {}): Promise<ActionResult> {
  if (Object.keys(config.images).length === 0) throw refusal('STACK_BUILD_NO_IMAGES', 'the deploy block declares no images');
  if (config.registry.host !== 'ghcr.io') throw refusal('STACK_BUILD_REGISTRY', `build supports ghcr.io only (deploy.registry.host is ${config.registry.host})`);
  const release = checkout(ctx, config);
  const items = plan(config, { sha: release.sha, owner: ownerOf(ctx, config) });
  const host = builderHost ?? (ctx.env.STARCI_BUILDER_HOST || undefined);
  const endpoint = host === undefined ? null : remoteBuilderEndpoint(host);
  const lines = [`release ${release.tag} at ${release.sha.slice(0, 12)}: ${items.length} image(s), registry ${config.registry.host} (${config.registry.visibility})`, ...items.map((item) => `  ${item.service}: ${item.dockerfile} -> ${item.ref}`)];
  lines.push(endpoint ? `builder: the remote BuildKit ${endpoint} (buildx ${REMOTE_BUILDER.builder})` : 'builder: this machine\'s docker buildx');
  if (!execute) {
    const scan = config.registry.visibility === 'public' ? ', scan for secret material' : '';
    return { ok: true, lines: [...lines, `dry run: would build${scan}${push ? ' and push' : ' (local only, no digest without --push)'}; nothing was built`], data: { tag: release.tag, images: {} } };
  }
  if (items.some((item) => { const entry = config.images[item.service]; return entry !== undefined && buildTimeArgs(entry).sealed !== null; })) requireAgeIdentity(ctx, config, 'build');
  const builder = endpoint ? ensureRemoteBuilder(ctx, config, endpoint) : null;
  const images: Record<string, string> = {};
  for (const item of items) {
    const outcome = processImage(ctx, config, item, await argsOf(ctx, config, item.app, item.hasBuildArgs), { push, builder });
    lines.push(...outcome.lines);
    if (!outcome.ok) return { ok: false, lines, data: { tag: release.tag, images } };
    if (push && !outcome.digest) return { ok: false, lines: [...lines, `${item.service} was pushed but docker reported no digest`], data: { tag: release.tag, images } };
    if (push) images[item.service] = `${item.ref.slice(0, item.ref.lastIndexOf(':'))}@${outcome.digest}`;
    lines.push(push ? `pushed ${item.service}: ${images[item.service]}` : `built ${item.service} (local image ${item.ref}; push it with --push to get a digest)`);
  }
  const visibility = push ? await checkVisibility(ctx, config, images) : { ok: true, lines: [], actual: {} };
  lines.push(...visibility.lines);
  if (push) lines.push('', 'for the deploy:', `${Object.entries(images).map(([service, ref]) => `--image ${service}=${ref}`).join(' ')} --sha ${release.sha}`);
  return { ok: visibility.ok, lines, data: { tag: release.tag, sha: release.sha, images, visibility: visibility.actual } };
}
