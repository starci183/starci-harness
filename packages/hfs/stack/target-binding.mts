// Public endpoint assertions for admitted native consumers; this module never opens custody.
import fs from 'node:fs';
import { memberFile } from '../runtime/scripts/lib/sealed-member.mjs';
import path from 'node:path';
import type { DeployConfig } from './config.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';

/** The public binding of a native owner to its docker-swarm target. */
export interface TargetBinding {
  kind: string;
  environment: string;
  stack: string;
  host: string;
  user: string;
  port: number;
}

const slug = (value: unknown): boolean => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
const label = (value: unknown): boolean => typeof value === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(value);
const host = (value: unknown): boolean => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value);
const denied = (): never => { throw refusal('STACKS_DEPLOY_CONFIG_INVALID', 'the native endpoint binding is invalid or differs from the selected owner target'); };
const exact = (value: unknown, fields: string[]): boolean => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value as object).length === fields.length && fields.every(key => Object.hasOwn(value as object, key));

function ordinaryInput(root: unknown, file: string): void {
  if (typeof root !== 'string' || !path.isAbsolute(root)) denied();
  const relative = path.relative(root as string, file);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) denied();
  let current = root as string;
  const parts = relative.split(path.sep);
  for (let index = 0; index <= parts.length; index += 1) {
    let stat: fs.Stats | undefined;
    try { stat = fs.lstatSync(current); } catch { denied(); }
    if (stat === undefined) return denied();
    if (stat.isSymbolicLink() || (index === parts.length ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory())) denied();
    if (index < parts.length) current = path.join(current, parts[index] as string);
  }
}

/** A bound native owner opens only an ordinary envelope below its actual app, without ancestor links. */
export const assertBoundCustody = (root: unknown, file: string): void => ordinaryInput(root, file);

/** Native custody can use AGE; tools that do not decrypt custody must not inherit that identity. */
export function nativeToolEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^SOPS_/i.test(key)));
}

/** Parse the internal public binding; ordinary commands without this flag retain their native behavior. */
export function parseTargetBinding(text: unknown, kind: string): Readonly<TargetBinding> | null {
  if (text === undefined) return null;
  // reason: the binding is parsed JSON from a flag; every field is checked below before use
  let binding: any;
  try { if (typeof text !== 'string' || text.length > 4096) denied(); binding = JSON.parse(text as string); } catch { denied(); }
  if (binding?.kind !== kind || !slug(binding.environment)) denied();
  if (kind === 'docker-swarm') {
    if (!exact(binding, ['kind', 'environment', 'stack', 'host', 'user', 'port']) || !slug(binding.stack)
      || !host(binding.host) || !label(binding.user) || binding.port !== 22) denied();
  } else denied();
  return Object.freeze(binding);
}

/** Require the selected sealed transport before any fallback can reach an operator's Docker or SSH context. */
export function bindStackTarget(ctx: Pick<StackContext, 'env'>, config: DeployConfig, binding: Readonly<TargetBinding> | null): DeployConfig {
  if (!binding) return config;
  if (binding.kind !== 'docker-swarm' || binding.environment !== config.env || binding.stack !== config.stack
    || !config.remote.sealed || ctx.env.DOCKER_HOST || ctx.env.DOCKER_CONTEXT || ctx.env.GITHUB_ACTIONS
    || ctx.env.STARCI_STACK_SEALED_SSH !== undefined) denied();
  const { sealed } = config.remote;
  if (!sealed) return denied();
  for (const member of Object.values(sealed)) {
    const file = memberFile(config.secretsDir, member);
    assertBoundCustody(config.repoRoot, file);
  }
  return { ...config, nativeTarget: binding };
}

/** Compare the effective private SSH account before key files, sessions or network effects exist. */
export function assertStackAccount(binding: Readonly<TargetBinding> | null | undefined, account: string, knownHosts: string): void {
  if (!binding) return;
  if (account !== `${binding.user}@${binding.host}` || binding.port !== 22 || !knownHosts.trim()) denied();
}
