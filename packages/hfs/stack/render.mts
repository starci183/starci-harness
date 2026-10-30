// render.mjs - renders a release: the committed stack source plus a generated override (image references, plain environment, the
// `<KEY>_FILE` pointers and the versioned secret grants) resolved by `docker stack config`. Writes `stack.generated.yaml`, `stack.yaml`
// and `release.json` under the output directory, and nothing at all when a guard refuses. Output carries names and counts only; the
// docker child gets a minimal environment, never the age identity or DOCKER_HOST. The override mirrors the source's compose version:
// Docker's legacy stack loader refuses mixed versions across its input files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readYaml } from './config.mjs';
import type { DeployConfig, ServiceEnvironment } from './config.mjs';
import { tool } from './context.mjs';
import type { StackContext } from './context.mjs';
import { hasPlaceholderDigest, isImageReference, isReleaseId } from './digest.mjs';
import { failure, refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import { configObjects, loadSealed, sha } from './sealed.mjs';
import type { ConfigObject, LoadedSealed } from './sealed.mjs';

/** What `render` takes. */
export interface RenderOptions {
  images?: Record<string, string> | undefined;
  sourceSha?: string | undefined;
  previous?: string | null | undefined;
  out?: string | null | undefined;
  allowUnpinned?: boolean | undefined;
  extraCompose?: string[] | undefined;
}

/** The generated override of one service. */
interface ServiceOverride {
  image?: string;
  environment?: Record<string, string>;
  secrets?: { source: string; target: string; mode: number }[];
}

const SOURCE_SHA = /^[0-9a-f]{7,64}$/u;
const ENV_LINE = /^([A-Z][A-Z0-9_]*)=(.*)$/u;
const BASE_ENV = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'DOCKER_CONFIG'];
const SECRET_MODE = 0o444;

function checkImages(config: DeployConfig, options: RenderOptions): void {
  const wanted = Object.keys(config.images);
  const images = options.images ?? {};
  const given = Object.keys(images);
  const missing = wanted.filter((service) => !given.includes(service));
  if (missing.length > 0) throw refusal('STACK_IMAGE_MISSING', `no image given for ${missing.join(', ')}`);
  const unknown = given.filter((service) => !wanted.includes(service));
  if (unknown.length > 0) throw refusal('STACK_IMAGE_UNKNOWN', `${unknown.join(', ')} is not an image of the deploy block`);
  for (const service of wanted) {
    const reference = images[service];
    if (hasPlaceholderDigest(reference)) throw refusal('STACK_PLACEHOLDER_DIGEST', `the image of ${service} carries the all-zero placeholder digest`);
    if (!isImageReference(reference, options.allowUnpinned === true)) throw refusal('STACK_IMAGE_UNPINNED', `the image of ${service} must be a registry reference pinned by @sha256 digest`);
  }
}

function checkInputs(config: DeployConfig, options: RenderOptions): void {
  checkImages(config, options);
  if (!SOURCE_SHA.test(String(options.sourceSha))) throw refusal('STACK_SOURCE_SHA_INVALID', 'sourceSha must be 7 to 64 lowercase hex characters');
  if (options.previous !== null && options.previous !== undefined && !isReleaseId(options.previous)) throw refusal('STACK_PREVIOUS_INVALID', 'previous must be 16 lowercase hex characters');
}

/** Docker reads an absent, empty or 3 version as its current 3.x default; every other version must match exactly. */
const versionKey = (version: unknown): string | null => {
  const text = version === undefined ? '' : String(version);
  return text === '' || text === '3' ? null : text;
};

function checkComposeVersions(sourceVersion: unknown, extraCompose: string[]): void {
  for (const file of extraCompose) {
    const version = readYaml(file, `the extra compose file ${path.basename(file)}`)?.version;
    if (versionKey(version) !== versionKey(sourceVersion)) {
      throw refusal('STACK_COMPOSE_VERSION_MISMATCH',
        `${path.basename(file)} declares compose version ${version ?? '(none)'} but the stack source declares ${sourceVersion ?? '(none)'}; docker stack config refuses files whose versions differ`);
    }
  }
}

/** Compose interpolation treats `$` specially; the override doubles it so a value reaches the service unchanged. */
const escapeDollar = (value: string): string => value.replaceAll('$', '$$$$');

function envFile(config: DeployConfig, rel: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(config.envDir, rel), 'utf8').split(/\r?\n/u)) {
    const match = ENV_LINE.exec(line);
    if (match) out[match[1] as string] = match[2] as string;
  }
  return out;
}

function plainEnvironment(config: DeployConfig, settings: Record<string, string>, entry: ServiceEnvironment): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of entry.files) Object.assign(out, envFile(config, rel));
  Object.assign(out, entry.values);
  for (const [name, setting] of Object.entries(entry.settings)) {
    const value = settings[setting.key] ?? setting.default;
    if (value !== null) out[name] = value;
  }
  return out;
}

function serviceOverride(config: DeployConfig, sealed: LoadedSealed, images: Record<string, string>, service: string): ServiceOverride {
  const grant = config.secrets.grants.find((item) => item.service === service);
  const environment = plainEnvironment(config, sealed.settings, config.environment[service] ?? { files: [], values: {}, settings: {} });
  const keys = sealed.grants[service] ?? [];
  if (grant?.filePointers) for (const key of keys) environment[`${key}_FILE`] = `/run/secrets/${key}`;
  const out: ServiceOverride = {};
  const image = images[service];
  if (image !== undefined) out.image = image;
  if (Object.keys(environment).length > 0) out.environment = Object.fromEntries(Object.entries(environment).map(([name, value]) => [name, escapeDollar(String(value))]));
  if (keys.length > 0) out.secrets = keys.map((key) => ({ source: key, target: key, mode: SECRET_MODE }));
  return out;
}

function buildOverride(config: DeployConfig, sealed: LoadedSealed, images: Record<string, string>, version: unknown): Record<string, unknown> {
  const services = new Set([...Object.keys(config.images), ...Object.keys(config.environment), ...Object.keys(sealed.grants)]);
  return {
    ...(version === undefined ? {} : { version }),
    services: Object.fromEntries([...services].sort((a, b) => a.localeCompare(b)).map((service) => [service, serviceOverride(config, sealed, images, service)])),
    secrets: Object.fromEntries(Object.entries(sealed.secrets).map(([key, entry]) => [key, { external: true, name: entry.runtimeName }])),
  };
}

function minimalEnv(ctx: StackContext, config: DeployConfig, configs: ConfigObject[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of BASE_ENV) if (ctx.env[name] !== undefined) env[name] = ctx.env[name];
  for (const name of config.passEnv) env[name] = ctx.env[name] ?? '';
  for (const object of configs) env[object.env] = object.name;
  return env;
}

function dockerRender(ctx: StackContext, config: DeployConfig, overrideFile: string, options: RenderOptions, env: NodeJS.ProcessEnv): string {
  const files = [config.stackFile, overrideFile, ...(options.extraCompose ?? [])].flatMap((file) => ['-c', file]);
  const run = tool(ctx, 'docker', ['stack', 'config', ...files], { env });
  if (run.error) throw failure('STACK_RENDER_FAILED', `cannot run docker (${run.error.message})`);
  if (run.status !== 0) throw failure('STACK_RENDER_FAILED', run.stderr.trim().split('\n').slice(0, 6).join(' | '));
  if (hasPlaceholderDigest(run.stdout)) throw refusal('STACK_PLACEHOLDER_DIGEST', 'rendered stack still carries a placeholder digest');
  // docker stack config has already interpolated every variable, so a dollar left in its output is literal (a source `$`); docker stack
  // deploy interpolates the written file again, so every dollar is escaped once more to survive that second pass.
  return escapeDollar(run.stdout);
}

function releaseRecord(ctx: StackContext, config: DeployConfig, parts: { sealed: LoadedSealed; configs: ConfigObject[]; options: RenderOptions; stackBytes: string; env: NodeJS.ProcessEnv }) {
  const { sealed, configs, options, stackBytes, env } = parts;
  const passed = Object.fromEntries(config.passEnv.map((name) => [name, env[name]]));
  const digestInput = { environment: config.environment, settings: Object.entries(sealed.settings).sort(([a], [b]) => a.localeCompare(b)), configs: configs.map((item) => item.name), passed };
  return {
    schema: 'starci/stack-release@1',
    stack: config.stack,
    releaseDigest: sha(stackBytes),
    sourceSha: options.sourceSha,
    images: options.images,
    configDigest: sha(JSON.stringify(digestInput)),
    configs: configs.map((item) => ({ logical: item.logical, name: item.name })),
    secrets: Object.entries(sealed.secrets).map(([key, entry]) => ({ key, runtimeName: entry.runtimeName })).sort((a, b) => a.key.localeCompare(b.key)),
    healthAssertions: [...config.verify.http, ...config.verify.exec].map((check) => check.name),
    previousAccepted: options.previous ?? null,
    renderedAt: new Date(ctx.now()).toISOString(),
  };
}

function writeOutput(out: string, override: unknown, stackBytes: string, release: unknown): void {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'stack.generated.yaml'), `${JSON.stringify(override, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'stack.yaml'), stackBytes);
  fs.writeFileSync(path.join(out, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
}

/** Renders a release into `options.out` (a fresh temp directory when null). Effects stay local; nothing leaves the machine. */
export async function renderRelease(ctx: StackContext, config: DeployConfig, options: RenderOptions): Promise<ActionResult> {
  checkInputs(config, options);
  const sourceVersion = readYaml(config.stackFile, 'the stack source')?.version;
  checkComposeVersions(sourceVersion, options.extraCompose ?? []);
  const sealed = loadSealed(ctx, config);
  const configs = configObjects(config);
  const override = buildOverride(config, sealed, options.images ?? {}, sourceVersion);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-override-'));
  try {
    const overrideFile = path.join(scratch, 'stack.generated.yaml');
    fs.writeFileSync(overrideFile, `${JSON.stringify(override, null, 2)}\n`);
    const env = minimalEnv(ctx, config, configs);
    const stackBytes = dockerRender(ctx, config, overrideFile, options, env);
    const release = releaseRecord(ctx, config, { sealed, configs, options, stackBytes, env });
    const out = options.out ?? fs.mkdtempSync(path.join(os.tmpdir(), 'stack-render-'));
    writeOutput(out, override, stackBytes, release);
    const releaseId = release.releaseDigest.slice(0, 16);
    const counts = { secrets: release.secrets.length, configs: configs.length };
    return {
      ok: true,
      lines: [`render: release ${releaseId}: ${counts.secrets} secrets, ${counts.configs} configs; images pinned`, `out: ${out}`],
      data: { releaseDigest: release.releaseDigest, releaseId, out, ...counts },
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
