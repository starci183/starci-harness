// scripts/api/sops/lib.mjs — shared file formats, identity admission and SOPS child capture.
// Custody members are committed as `<name>.<fmt>.enc`; sops infers a format from the LAST extension, so `.enc` reads as
// binary and every read states the format (--input-type). The call files (decrypt.mjs, encrypt.mjs, exec-env.mjs) each
// name one sops use.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { readSecretBytes, CREDENTIAL_FILE_MAX_BYTES, sopsIdentityEnv, type SopsIdentity } from '../../../engine/secrets.mjs';
import { selectedAgeEnvelope } from '../../lib/sops-envelope.mjs';
import { errorCode } from '../fs/lib.mjs';

type PathModule = typeof path.posix;
type SopsFilesystem = Pick<typeof fs, 'readdirSync' | 'statSync'>;
/** resolveSops' options: platform, pathext (PATHEXT names), wingetPackageTree (the full package tree), filesystem (a probe). */
export interface ResolveSopsOptions { platform?: NodeJS.Platform; pathext?: boolean; wingetPackageTree?: boolean; filesystem?: SopsFilesystem }

/** The observed child result or a typed refusal: {status, stdout, stderr, error}. */
export interface SopsResult { status: number | null; stdout: string | null; stderr: string | null; error: (Error & { code?: string; identityRefusal?: string; publicRecipient?: string; sopsFailure?: string }) | null }
/** One program run the selected path observes (a spawnSync result; Buffers when captured). */
export interface Capture { status?: number | null; signal?: string | null; error?: (Error & { code?: string }) | null | undefined; stdout?: Buffer | string | null; stderr?: Buffer | string | null }
interface BufferCapture extends Capture { status: number; stdout: Buffer; stderr: Buffer }
/** The domain's process owner: runProgram(file, args, options) and resolveRealTool(program, {env}). */
export interface SopsInvocation {
  runProgram: (file: string, args: string[], options: SpawnSyncOptions) => Capture;
  resolveRealTool: (program: string, options: { env: NodeJS.ProcessEnv }) => string | null;
}
/** What sopsIdentityEnv answers: the admitted env, or an error (an inline context carries identityRefusal and inlineName). */
export type IdentitySelection = Pick<SopsIdentity, 'env' | 'inlineName' | 'error'>;
type Env = NodeJS.ProcessEnv;
export interface RunSopsFileOptions { identity?: string | null; invocation?: SopsInvocation | null; env?: Env; cwd?: string | undefined; maxBuffer?: number; timeout?: number | undefined }
/** The request runSelectedSops owns: a seal of in-memory plaintext, or a decrypt/encrypt over caller-supplied sops arguments. */
export interface SelectedRequest { operation: 'seal' | 'encrypt' | 'decrypt'; params?: { inputType?: string; plaintext?: string | Buffer; recipients?: string[]; filenameOverride?: string } | undefined; args?: string[] | undefined }
interface OwnedSpec { inputType: string | undefined; outputType: string | undefined; file: string; recipient: string | undefined; plaintext?: string | Buffer }
interface SelectedContext { selection: IdentitySelection; invocation: SopsInvocation | null; env: Env; cwd: string | undefined; maxBuffer: number | undefined; timeout: number | undefined }
interface AdmittedSpec extends OwnedSpec { inputType: string; outputType: string }
interface Admitted { key: string; spec: AdmittedSpec; invocation: SopsInvocation }
interface PerformInput { bin: string | null; request: SelectedRequest; spec: AdmittedSpec; key: string; inlineName: string; invocation: SopsInvocation; env: Env; cwd: string | undefined; maxBuffer: number | undefined; timeout: number | undefined }
interface SelectedState { input: Buffer | undefined; identity: Buffer | undefined; selectedEnv: Env | undefined; captures: Capture[] }
interface AgeState { identity: Buffer | undefined; captures: Capture[] }
export interface PublicAgeRequest { env: Env; cwd: string; invocation: SopsInvocation }
type PublicAgeFailure = { ok: false; reason: string };
export type PublicAgeOutcome = PublicAgeFailure | { ok: true; publicRecipient: string };
/** What the installer's publication of a captured identity answers. */
export interface Publication { ok: boolean; effectState: 'none' | 'unknown' | 'complete'; created: boolean; durability: string }
export interface IdentityRequest { env: Env; cwd: string; invocation: SopsInvocation; assertLease: () => boolean; consume: (identity: Buffer, recipient: string) => Publication }
interface IdentityFailure { ok: false; reason: string; captureState: string; effectState: string }
type IdentityOutcome = IdentityFailure | { ok: true; captureState: 'generated'; effectState: 'complete'; created: boolean; durability: string; publicRecipient: string };
interface GenState { captures: Capture[]; generated: boolean; identity: Buffer | undefined }
type Run = (program: string, args: string[], bytes?: Buffer, childEnv?: Env) => Capture;

const FORMATS: Record<string, string> = { yaml: 'yaml', yml: 'yaml', json: 'json', env: 'dotenv', dotenv: 'dotenv' };

/** The sops input type `<name>.<format>.enc` states, or the explicit override. Throws when neither names one. */
export function custodyInputType(file: unknown, override?: string | null): string {
  if (override) {
    if (!Object.values(FORMATS).includes(override)) throw new Error(`unsupported --input-type ${override}`);
    return override;
  }
  const match = /\.([a-z]+)\.enc$/iu.exec(String(file));
  const type = match ? FORMATS[(match[1] ?? '').toLowerCase()] : undefined;
  if (!type) throw new Error(`${file}: name it <name>.<yaml|json|env>.enc or pass --input-type`);
  return type;
}

const sopsNames = (env: NodeJS.ProcessEnv, win: boolean, pathext: boolean): string[] => {
  if (!win) return ['sops'];
  if (!pathext) return ['sops.exe', 'sops'];
  return String(env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean).map((ext) => `sops${ext}`);
};

const nestedPackageDirs = (filesystem: SopsFilesystem, paths: PathModule, directory: string): string[] => {
  const dirs: string[] = [];
  try {
    for (const nested of filesystem.readdirSync(directory, { withFileTypes: true })) {
      if (nested.isDirectory()) dirs.push(paths.join(directory, nested.name));
    }
  } catch { /* unreadable package */ }
  return dirs;
};

const wingetPackageDirs = (filesystem: SopsFilesystem, paths: PathModule, packages: string, wingetPackageTree: boolean): string[] => {
  const dirs: string[] = [];
  try {
    for (const entry of filesystem.readdirSync(packages)) {
      if (!wingetPackageTree && !/sops/i.test(entry)) continue;
      const directory = paths.join(packages, entry);
      dirs.push(directory);
      if (wingetPackageTree) dirs.push(...nestedPackageDirs(filesystem, paths, directory));
    }
  } catch { /* no WinGet packages */ }
  return dirs;
};

const wingetDirs = (filesystem: SopsFilesystem, paths: PathModule, env: NodeJS.ProcessEnv, wingetPackageTree: boolean): string[] => {
  const dirs: string[] = [];
  if (!env.LOCALAPPDATA) return dirs;
  const winget = paths.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet');
  dirs.push(paths.join(winget, 'Links'), ...wingetPackageDirs(filesystem, paths, paths.join(winget, 'Packages'), wingetPackageTree));
  return dirs;
};

/** Resolve SOPS from PATH and WinGet. Consumers select PATHEXT names and the full package tree for their launcher. */
export function resolveSops(env: NodeJS.ProcessEnv = process.env, { platform = process.platform, pathext = false, wingetPackageTree = false, filesystem = fs }: ResolveSopsOptions = {}): string | null {
  const win = platform === 'win32';
  const paths = win ? path.win32 : path.posix;
  const names = sopsNames(env, win, pathext);
  const dirs = String(env.PATH ?? '').split(win ? ';' : ':').filter(Boolean);
  if (win) dirs.push(...wingetDirs(filesystem, paths, env, wingetPackageTree));
  for (const directory of dirs) for (const name of names) {
    const file = paths.join(directory, name);
    try { if (filesystem.statSync(file).isFile()) return file; } catch { /* next candidate */ }
  }
  return null;
}

/**
 * Select the caller's identity once, then run the encrypt/decrypt file action through its admitted SOPS path.
 * Inline selection delegates the unchanged request to runSelectedSops; original FILE and recipient-only modes retain their existing child transport.
 * @param {string|null} bin Explicit SOPS executable, or null to resolve it from the selected environment.
 * @param {string[]} args The caller's SOPS argument array; no private identity is added to it.
 * @param {'encrypt'|'decrypt'} operation The public file action, which owns identity requirements and capture defaults.
 * @param {object} options Original identity, selected invocation ports, environment, cwd, timeout and maxBuffer.
 * @returns {{status: number|null, stdout: string|null, stderr: string|null, error: Error|null}} The unchanged child result or typed prelaunch refusal.
 */
export function runSopsFile(bin: string | null, args: string[], operation: 'encrypt' | 'decrypt', options: RunSopsFileOptions = {}): SopsResult {
  const { identity = null, invocation = null, env = process.env, cwd = undefined } = options;
  let maxBuffer: number, timeout: number | undefined;
  if (operation === 'decrypt') ({ maxBuffer = 16 * 1024 * 1024, timeout = undefined } = options);
  else ({ timeout = undefined, maxBuffer = 1024 * 1024 } = options);
  const selected = sopsIdentityEnv(env, operation === 'decrypt' ? { identity, required: true } : { identity });
  if (selected.error?.identityRefusal === 'inline-context-unqualified') return runSelectedSops(bin, { operation, args }, { selection: selected, invocation, env, cwd, maxBuffer, timeout });
  if (selected.error) return { status: null, stdout: '', stderr: '', error: selected.error };
  const selectedEnv = selected.env as NodeJS.ProcessEnv; // every SopsIdentity without an error carries its env
  const exe = bin ?? resolveSops(selectedEnv);
  if (!exe) return { status: null, stdout: '', stderr: '', error: Object.assign(new Error('sops is not installed (Windows: winget install Mozilla.SOPS)'), { code: 'SOPS_MISSING' }) };
  const r = spawnSync(exe, args, {
    encoding: 'utf8', windowsHide: true, maxBuffer, timeout, env: selectedEnv,
    ...(operation === 'decrypt' ? { cwd } : { stdio: ['ignore', 'pipe', 'pipe'] }),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error ?? null };
}

const SELECTED_SOPS_VERSIONS = new Set(['3.13.2', '3.13.3']);
export const SELECTED_AGE_VERSIONS = new Set(['1.2.1', '1.3.1']);
const IDENTITY_TIMEOUT_MS = 20_000;
const CONTROLLED_ENV = new Set(['SOPS_AGE_KEY', 'SOPS_AGE_KEY_FILE', 'SOPS_AGE_KEY_CMD', 'SOPS_AGE_SSH_PRIVATE_KEY_FILE', 'SOPS_AGE_SSH_PRIVATE_KEY_CMD', 'SOPS_AGE_RECIPIENT', 'SOPS_KEYSERVICE', 'SOPS_ENABLE_LOCAL_KEYSERVICE', 'SOPS_DECRYPTION_ORDER', 'SOPS_KMS_ARN', 'SOPS_GCP_KMS_IDS', 'SOPS_HUAWEICLOUD_KMS_IDS', 'SOPS_AZURE_KEYVAULT_URLS', 'SOPS_VAULT_URIS', 'SOPS_PGP_FP', 'SOPS_AGE_RECIPIENTS', 'HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME']);

/**
 * Construct only the child map; empty desktop roots make Go return directory errors, not fallback paths.
 * @param {object} env The admitted caller environment.
 * @param {string|null} inlineName Selected inline identity name, or null to omit every identity.
 */
function isolatedSopsEnv(env: Env, inlineName: string | null = 'SOPS_AGE_KEY'): Env {
  const out = Object.fromEntries(Object.entries(env).filter(([name]) => !CONTROLLED_ENV.has(name.toUpperCase())));
  out.HOME = ''; out.USERPROFILE = ''; out.APPDATA = ''; out.XDG_CONFIG_HOME = '';
  if (inlineName !== null) out.SOPS_AGE_KEY = env[inlineName];
  return out;
}

/**
 * A refusal of the selected invocation. `detail` says what failed in public words; `facts` carries only public values the caller
 * names in its own refusal (`publicRecipient`, the selected identity's recipient; `sopsFailure`, the class of a failed sops run).
 */
const held = (reason: string, detail = 'the selected invocation was not qualified', facts: Record<string, string> = {}): SopsResult => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error(`SOPS selected identity [${reason}]: ${detail}`), { name: 'SopsIdentityRefusal', identityRefusal: reason, ...facts }) });
const nativeFile = (file: unknown): file is string => {
  if (typeof file !== 'string' || !path.isAbsolute(file) || /\.(?:[cm]?js|cmd|bat|ps1|sh)$/i.test(file)) return false;
  let fd: number | undefined;
  try {
    const before = fs.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink()) return false;
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = fs.fstatSync(fd), head = Buffer.alloc(64);
    if (!stat.isFile() || before.dev !== stat.dev || before.ino !== stat.ino || fs.readSync(fd, head, 0, head.length, 0) < 20) return false;
    if (process.platform === 'win32' && head.toString('ascii', 0, 2) === 'MZ') {
      const offset = head.readUInt32LE(60), pe = Buffer.alloc(6);
      return offset >= 64 && offset + pe.length <= stat.size && fs.readSync(fd, pe, 0, pe.length, offset) === pe.length && pe.toString('ascii', 0, 4) === 'PE\0\0';
    }
    if (process.platform === 'linux') return head.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    if (process.platform === 'darwin') return new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]).has(head.readUInt32BE(0));
    return false;
  } catch { return false; }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* no private result or success credit */ } } }
};
const auditAbsent = (cwd: string | undefined): boolean => {
  try { fs.lstatSync(path.resolve(cwd ?? process.cwd(), '/etc/sops/audit.yaml')); return false; }
  catch (error) { return errorCode(error) === 'ENOENT'; }
};
const captured = (r: Capture | null | undefined): r is BufferCapture => r?.status === 0 && r.signal == null && !r.error && Buffer.isBuffer(r.stdout) && Buffer.isBuffer(r.stderr);
const decoded = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const ownedRequest = (request: SelectedRequest): OwnedSpec | null => {
  if (request.operation === 'seal') {
    const p = request.params;
    if (!p || !Array.isArray(p.recipients) || p.recipients.length !== 1 || typeof p.filenameOverride !== 'string' || !p.filenameOverride || (typeof p.plaintext !== 'string' && !Buffer.isBuffer(p.plaintext)) || Buffer.byteLength(p.plaintext) > CREDENTIAL_FILE_MAX_BYTES) return null;
    return { inputType: p.inputType, outputType: p.inputType, file: p.filenameOverride, recipient: p.recipients[0], plaintext: p.plaintext };
  }
  const args = request.args;
  if (!Array.isArray(args) || !['decrypt', '--decrypt', 'encrypt', '--encrypt'].includes(args[0] ?? '') || args.some(value => typeof value !== 'string')) return null;
  const file = args.at(-1);
  if (!file || file.startsWith('-')) return null;
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length - 1; i += 2) {
    const flag = args[i] ?? '';
    if (!['--input-type', '--output-type', '--age'].includes(flag) || Object.hasOwn(flags, flag) || i + 1 >= args.length - 1) return null;
    flags[flag] = args[i + 1] ?? '';
  }
  if (request.operation === 'decrypt' && (args[0] !== 'decrypt' && args[0] !== '--decrypt' || Object.hasOwn(flags, '--age'))) return null;
  if (request.operation === 'encrypt' && (args[0] !== 'encrypt' && args[0] !== '--encrypt' || !flags['--age'] || flags['--age'].includes(','))) return null;
  return { inputType: flags['--input-type'], outputType: flags['--output-type'], file, recipient: flags['--age'] };
};

/** The admitted identity key, or the unchanged refusal/failure result (admitted.key is absent then). */
const selectedAdmission = (selection: IdentitySelection, inlineName: string, spec: OwnedSpec | null, invocation: SopsInvocation | null | undefined, env: Env): SopsResult | Admitted => {
  const fail = (): SopsResult => ({ status: null, stdout: '', stderr: '', error: selection.error ?? null });
  const isFormat = (type: string | undefined): type is string => type !== undefined && ['binary', 'json', 'yaml', 'dotenv'].includes(type);
  if (!spec || !isFormat(spec.inputType) || !isFormat(spec.outputType)) return fail();
  if (!invocation || typeof invocation.runProgram !== 'function' || typeof invocation.resolveRealTool !== 'function') return fail();
  if (!['win32', 'linux', 'darwin'].includes(process.platform)) return held('unsupported-platform');
  const key = env[inlineName];
  if (typeof key !== 'string' || !/^AGE-SECRET-KEY-1[0-9A-Z]+$/.test(key.trim())) return fail();
  return { key, spec: { ...spec, inputType: spec.inputType, outputType: spec.outputType }, invocation };
};

const decryptArgs = (file: string, inputType: string, outputType: string): string[] => ['decrypt', '--input-type', inputType, '--output-type', outputType, '--filename-override', file, '--enable-local-keyservice=true', '--decryption-order', 'age'];

/**
 * The class of a failed sops run, read from its stderr and exit; sops prints no value there, and only the class leaves. Classes:
 * no-matching-identity (no age entry opens with the identity), mac-mismatch (the document changed after it was sealed),
 * unparsable-document (the bytes are not the format they were read as), timeout, or exit-<n>.
 */
export function sopsFailureClass(result: Capture | null | undefined): string {
  if (result?.error?.code === 'ETIMEDOUT' || result?.signal === 'SIGTERM') return 'timeout';
  const text = Buffer.isBuffer(result?.stderr) ? result.stderr.toString('utf8') : String(result?.stderr ?? '');
  if (/MAC mismatch/iu.test(text)) return 'mac-mismatch';
  if (/no identity matched|failed to get the data key|could not decrypt data key|0 successful groups/iu.test(text)) return 'no-matching-identity';
  if (/unmarshal|could not parse|error loading file|invalid character|yaml:/iu.test(text)) return 'unparsable-document';
  return `exit-${String(result?.status ?? 'none')}`;
}

const decryptSelected = (run: Run, exe: string, file: string, input: Buffer, spec: AdmittedSpec, recipient: string): SopsResult => {
  const facts = { publicRecipient: recipient };
  const envelope = selectedAgeEnvelope(decoded(input), spec.inputType, recipient);
  if (!envelope.ok) return held(envelope.reason, `the ${spec.inputType} envelope was refused for the selected recipient ${recipient}`, facts);
  const result = run(exe, decryptArgs(file, spec.inputType, spec.outputType), input);
  if (!captured(result)) {
    const failure = sopsFailureClass(result);
    return held('selected-decryption-failed', `sops could not decrypt the ${spec.inputType} document with the selected recipient ${recipient} (${failure})`, { ...facts, sopsFailure: failure });
  }
  return { status: 0, stdout: decoded(result.stdout), stderr: '', error: null };
};

const encryptSelected = (run: Run, exe: string, file: string, input: Buffer, spec: AdmittedSpec, recipient: string): SopsResult => {
  if (spec.recipient !== recipient) return held('recipient-mismatch');
  const args = ['encrypt', '--input-type', spec.inputType, '--output-type', spec.outputType, '--filename-override', file, '--enable-local-keyservice=true', '--age', recipient];
  const result = run(exe, args, input);
  if (!captured(result)) return held('selected-encryption-failed');
  if (result.stdout.length > CREDENTIAL_FILE_MAX_BYTES) return held('document-over-budget');
  const text = decoded(result.stdout);
  const envelope = selectedAgeEnvelope(text, spec.outputType, recipient);
  if (!envelope.ok) return held(envelope.reason);
  const readback = run(exe, decryptArgs(file, spec.outputType, spec.inputType), result.stdout);
  if (!captured(readback)) return held('selected-readback-failed');
  return { status: 0, stdout: text, stderr: '', error: null };
};

const wipeCaptures = (captures: Capture[]): void => {
  for (const result of captures) {
    if (Buffer.isBuffer(result?.stdout)) result.stdout.fill(0);
    if (Buffer.isBuffer(result?.stderr)) result.stderr.fill(0);
  }
};

// The one recipient an `age -y` capture names, or null.
const recipientOf = (stdout: Uint8Array): string | null => {
  const recipients = decoded(stdout).trim().split(/\r?\n/);
  const first = recipients[0];
  return recipients.length === 1 && first !== undefined && /^age1[ac-hj-np-z02-9]+$/.test(first) ? first : null;
};

const toolProfileSupported = (version: Capture, ageVersion: Capture): boolean => captured(version) && captured(ageVersion)
  && SELECTED_SOPS_VERSIONS.has(/^sops\s+(\d+\.\d+\.\d+)/.exec(decoded(version.stdout))?.[1] ?? '')
  && SELECTED_AGE_VERSIONS.has(/^v?(\d+\.\d+\.\d+)/.exec(decoded(ageVersion.stdout))?.[1] ?? '');

const invalidCaptureBudget = (deadline: number, maxBuffer: number | undefined): boolean => !Number.isInteger(deadline) || deadline < 1 || deadline > 2_147_483_647 || typeof maxBuffer !== 'number' || !Number.isInteger(maxBuffer) || maxBuffer < 1;

const publicAgeFailure = (reason: string): PublicAgeFailure => ({ ok: false, reason });
const publicAgeRequestValid = (request: Partial<PublicAgeRequest>): request is PublicAgeRequest => Boolean(request.env) && typeof request.env === 'object' && !Array.isArray(request.env)
  && path.isAbsolute(request.cwd ?? '') && typeof request.invocation?.runProgram === 'function'
  && typeof request.invocation?.resolveRealTool === 'function';
const publicAgeCapture = (result: Capture): result is BufferCapture => captured(result) && result.stdout.length <= CREDENTIAL_FILE_MAX_BYTES
  && result.stderr.length <= CREDENTIAL_FILE_MAX_BYTES;

const deriveSelectedAgeRecipient = (state: AgeState, { env, cwd, invocation }: PublicAgeRequest, selection: IdentitySelection): PublicAgeOutcome => {
  const key = env[selection.inlineName ?? ''];
  if (typeof key !== 'string' || !/^AGE-SECRET-KEY-1[0-9A-Z]+$/.test(key.trim())) return publicAgeFailure('invalid-inline');
  const age = invocation.resolveRealTool('age-keygen', { env });
  if (!nativeFile(age)) return publicAgeFailure('native-tool-unavailable');
  const publicEnv = isolatedSopsEnv(env, null);
  const options: SpawnSyncOptions & { maxBuffer: number } = { cwd, shell: false, encoding: 'buffer', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    timeout: IDENTITY_TIMEOUT_MS, maxBuffer: CREDENTIAL_FILE_MAX_BYTES };
  const run = selectedRunner(invocation, options, state.captures, publicEnv);
  const version = run(age, ['--version']);
  if (!publicAgeCapture(version) || !SELECTED_AGE_VERSIONS.has(/^v?(\d+\.\d+\.\d+)/.exec(decoded(version.stdout))?.[1] ?? '')) return publicAgeFailure('unsupported-tool-profile');
  state.identity = Buffer.from(key.trim(), 'utf8');
  const derived = run(age, ['-y'], state.identity);
  if (!publicAgeCapture(derived)) return publicAgeFailure('recipient-unproven');
  const recipient = recipientOf(derived.stdout);
  if (recipient === null) return publicAgeFailure('recipient-unproven');
  return { ok: true, publicRecipient: recipient };
};

/** Derive only the public recipient of an explicitly selected inline identity; no private capture escapes. */
export function selectedAgeRecipient(options: Partial<PublicAgeRequest> = {}): PublicAgeOutcome {
  if (!publicAgeRequestValid(options)) return publicAgeFailure('invalid-request');
  const selection = sopsIdentityEnv(options.env, { required: true });
  if (selection.error?.identityRefusal !== 'inline-context-unqualified') return publicAgeFailure(selection.error?.identityRefusal ?? 'selected-inline-required');
  const state: AgeState = { identity: undefined, captures: [] };
  try {
    return deriveSelectedAgeRecipient(state, options, selection);
  } catch { return publicAgeFailure('selected-native-refused'); }
  finally {
    state.identity?.fill(0);
    wipeCaptures(state.captures);
  }
}

// The document bytes into `state.input`; the refusal when they are unavailable or over budget, else null.
const readSelectedInput = (state: SelectedState, request: SelectedRequest, spec: OwnedSpec, file: string): SopsResult | Buffer => {
  let input: Buffer;
  try { input = request.operation === 'seal' ? Buffer.from(spec.plaintext ?? '') : readSecretBytes(file); state.input = input; } catch { return held('actual-document-unavailable'); }
  return input.length > CREDENTIAL_FILE_MAX_BYTES ? held('document-over-budget') : input;
};

const selectedRunner = (invocation: SopsInvocation, options: SpawnSyncOptions, captures: Capture[], selectedEnv: Env): Run => (program, args, bytes, childEnv = selectedEnv) => {
  const result = invocation.runProgram(program, args, { ...options, env: childEnv, input: bytes });
  captures.push(result); return result;
};

const performSelected = (state: SelectedState, { bin, request, spec, key, inlineName, invocation, env, cwd, maxBuffer, timeout }: PerformInput): SopsResult => {
  const file = path.resolve(cwd ?? process.cwd(), spec.file);
  const input = readSelectedInput(state, request, spec, file);
  if (!Buffer.isBuffer(input)) return input;
  const exe = bin ?? resolveSops(env), age = invocation.resolveRealTool('age-keygen', { env });
  if (!nativeFile(exe) || !nativeFile(age)) return held('native-tool-unavailable');
  if (!auditAbsent(cwd)) return held('unsupported-audit-context');
  const deadline = timeout ?? IDENTITY_TIMEOUT_MS;
  if (invalidCaptureBudget(deadline, maxBuffer)) return held('invalid-capture-budget');
  state.selectedEnv = isolatedSopsEnv(env, inlineName);
  const publicEnv = isolatedSopsEnv(env, null);
  const options: SpawnSyncOptions = { cwd, env: state.selectedEnv, shell: false, encoding: 'buffer', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: deadline, maxBuffer };
  const run = selectedRunner(invocation, options, state.captures, state.selectedEnv);
  const version = run(exe, ['--disable-version-check', '--version'], undefined, publicEnv);
  const ageVersion = run(age, ['--version'], undefined, publicEnv);
  if (!toolProfileSupported(version, ageVersion)) return held('unsupported-tool-profile');
  state.identity = Buffer.from(key.trim(), 'utf8');
  const derived = run(age, ['-y'], state.identity, publicEnv);
  if (!captured(derived)) return held('recipient-unproven');
  const recipient = recipientOf(derived.stdout);
  if (recipient === null) return held('recipient-unproven');
  if (request.operation === 'decrypt') return decryptSelected(run, exe, file, input, spec, recipient);
  return encryptSelected(run, exe, file, input, spec, recipient);
};

/** The domain composes the existing process owner: invocation={runProgram(file,args,options),resolveRealTool(program,{env})}. No API imports another system. */
export function runSelectedSops(bin: string | null, request: SelectedRequest, { selection, invocation, env, cwd, maxBuffer, timeout }: Partial<SelectedContext> = {}): SopsResult {
  if (selection?.error?.identityRefusal !== 'inline-context-unqualified' || typeof selection.inlineName !== 'string' || !env || typeof env !== 'object') return held('selected-context-missing');
  const spec = ownedRequest(request);
  const admitted = selectedAdmission(selection, selection.inlineName, spec, invocation, env);
  if (!('key' in admitted)) return admitted;
  const state: SelectedState = { input: undefined, identity: undefined, selectedEnv: undefined, captures: [] };
  try {
    return performSelected(state, { bin, request, spec: admitted.spec, key: admitted.key, inlineName: selection.inlineName, invocation: admitted.invocation, env, cwd, maxBuffer, timeout });
  } catch { return held('selected-native-refused'); }
  finally {
    state.identity?.fill(0); state.input?.fill(0);
    wipeCaptures(state.captures);
    if (state.selectedEnv) delete state.selectedEnv.SOPS_AGE_KEY;
  }
}

/**
 * `sops --config <config> updatekeys -y --input-type <type> <file>` under an inline selected identity: the member's data key is
 * opened with SOPS_AGE_KEY in an isolated child environment and wrapped again to the recipients the config's rule names; no value
 * is decrypted to stdout or disk. The tool profile is the selected one; captures are wiped.
 */
export function runSelectedUpdateKeys(bin: string | null, { file, config, inputType }: { file: string; config: string; inputType: string }, { selection, invocation, env, cwd, timeout }: Partial<SelectedContext> = {}): SopsResult {
  if (selection?.error?.identityRefusal !== 'inline-context-unqualified' || typeof selection.inlineName !== 'string' || !env || typeof env !== 'object') return held('selected-context-missing');
  if (!invocation || typeof invocation.runProgram !== 'function' || typeof invocation.resolveRealTool !== 'function') return held('selected-context-missing');
  if (!['yaml', 'dotenv', 'json'].includes(inputType) || !path.isAbsolute(file ?? '') || !path.isAbsolute(config ?? '')) return held('invalid-request');
  const key = env[selection.inlineName ?? ''];
  if (typeof key !== 'string' || !/^AGE-SECRET-KEY-1[0-9A-Z]+$/.test(key.trim())) return held('invalid-inline');
  const captures: Capture[] = [];
  try {
    const exe = bin ?? resolveSops(env), age = invocation.resolveRealTool('age-keygen', { env });
    if (!nativeFile(exe) || !nativeFile(age)) return held('native-tool-unavailable');
    if (!auditAbsent(cwd)) return held('unsupported-audit-context');
    const publicEnv = isolatedSopsEnv(env, null);
    const options: SpawnSyncOptions = { cwd, shell: false, encoding: 'buffer', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: timeout ?? IDENTITY_TIMEOUT_MS, maxBuffer: CREDENTIAL_FILE_MAX_BYTES };
    const run = (program: string, args: string[], childEnv: Env): Capture => {
      const result = invocation.runProgram(program, args, { ...options, env: childEnv });
      captures.push(result); return result;
    };
    if (!toolProfileSupported(run(exe, ['--disable-version-check', '--version'], publicEnv), run(age, ['--version'], publicEnv))) return held('unsupported-tool-profile');
    const result = run(exe, ['--disable-version-check', '--config', config, 'updatekeys', '-y', '--input-type', inputType, file], isolatedSopsEnv(env, selection.inlineName));
    if (!captured(result)) return { status: result?.status ?? null, stdout: '', stderr: '', error: result?.error ?? null };
    return { status: 0, stdout: '', stderr: '', error: null };
  } catch { return held('selected-native-refused'); }
  finally { wipeCaptures(captures); }
}

const identityRequestValid = (request: Partial<IdentityRequest>): request is IdentityRequest => Boolean(
  request.env && typeof request.env === 'object' && path.isAbsolute(request.cwd ?? '') && typeof request.consume === 'function'
    && typeof request.assertLease === 'function' && typeof request.invocation?.runProgram === 'function'
    && typeof request.invocation?.resolveRealTool === 'function');
const identityLinesValid = (lines: string[], identities: string[]): boolean => identities.length === 1 && /^AGE-SECRET-KEY-1[0-9A-Z]+$/.test(identities[0] ?? '')
  && !lines.some(line => line.startsWith('#') && !/^# (?:created:|public key:)/.test(line));
const declaredRecipientMatches = (lines: string[], recipient: string): boolean => {
  const declared = lines.filter(line => line.startsWith('# public key:'));
  return declared.length === 1 && declared[0]?.slice('# public key:'.length).trim() === recipient;
};
const publicationShaped = (publication: Publication | null | undefined): publication is Publication => Boolean(publication && typeof publication.ok === 'boolean' && ['none', 'unknown', 'complete'].includes(publication.effectState));
const publicationDurable = (publication: Publication): boolean => [true, false].includes(publication.created) && ['file-fsync', 'file-and-parent-fsync', 'file-fsync-namespace-unqualified'].includes(publication.durability);

const identityFailure = (reason: string, generated: boolean): IdentityFailure => ({ ok: false, reason, captureState: generated ? 'unknown' : 'none', effectState: generated ? 'unknown' : 'none' });

// The outcome of handing the captured identity to the installer's publication.
const publicationOutcome = (publication: Publication | null | undefined, recipient: string): IdentityOutcome => {
  if (!publicationShaped(publication)) return identityFailure('publication-unknown', true);
  if (!publication.ok || publication.effectState !== 'complete') return { ok: false, captureState: 'generated', effectState: publication.effectState,
    reason: 'publication-held' };
  if (!publicationDurable(publication)) return identityFailure('publication-unknown', true);
  return { ok: true, captureState: 'generated', effectState: 'complete', created: publication.created,
    durability: publication.durability, publicRecipient: recipient };
};

// One age-keygen run under the caller's lease, its capture kept for wiping.
const leasedAgeRunner = (invocation: SopsInvocation, age: string, options: SpawnSyncOptions & { maxBuffer: number }, captures: Capture[], assertLease: () => boolean) => (args: string[], input?: Buffer): BufferCapture => {
  if (assertLease() !== true) throw new Error('initial age lease lost');
  const result = invocation.runProgram(age, args, { ...options, input });
  captures.push(result);
  if (!captured(result) || result.stdout.length > options.maxBuffer || result.stderr.length > options.maxBuffer) throw new Error('initial age capture incomplete');
  return result;
};

const generateAndPublish = (state: GenState, { env, cwd, invocation, assertLease, consume }: IdentityRequest): IdentityOutcome => {
  const age = invocation.resolveRealTool('age-keygen', { env });
  if (!nativeFile(age)) return identityFailure('native-tool-unavailable', false);
  const options: SpawnSyncOptions & { maxBuffer: number } = { cwd, env: isolatedSopsEnv(env, null), shell: false, encoding: 'buffer', windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'], timeout: IDENTITY_TIMEOUT_MS, maxBuffer: CREDENTIAL_FILE_MAX_BYTES };
  const run = leasedAgeRunner(invocation, age, options, state.captures, assertLease);
  const version = run(['--version']);
  if (!SELECTED_AGE_VERSIONS.has(/^v?(\d+\.\d+\.\d+)/.exec(decoded(version.stdout))?.[1] ?? '')) return identityFailure('unsupported-tool-profile', false);
  if (assertLease() !== true) return identityFailure('lease-lost', false);
  state.generated = true;
  const made = run([]), lines = decoded(made.stdout).trim().split(/\r?\n/);
  const identities = lines.filter(line => line && !line.startsWith('#'));
  if (!identityLinesValid(lines, identities)) return identityFailure('capture-incomplete', true);
  state.identity = Buffer.from(identities[0] ?? '', 'utf8');
  const recipient = recipientOf(run(['-y'], state.identity).stdout);
  if (recipient === null) return identityFailure('recipient-unproven', true);
  if (!declaredRecipientMatches(lines, recipient) || assertLease() !== true) return identityFailure('recipient-unproven', true);
  return publicationOutcome(consume(state.identity, recipient), recipient);
};

/** One real private capture for an admitted initial request; the installer owns its durable attempt. */
export function withGeneratedAgeIdentity(request: Partial<IdentityRequest> = {}): IdentityOutcome {
  if (!identityRequestValid(request)) return identityFailure('invalid-request', false);
  const state: GenState = { captures: [], generated: false, identity: undefined };
  try {
    return generateAndPublish(state, request);
  } catch { return identityFailure('capture-or-publication-unknown', state.generated); }
  finally {
    state.identity?.fill(0);
    wipeCaptures(state.captures);
  }
}
