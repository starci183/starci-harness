import fs from 'node:fs';
import { parseYaml } from '../../engine/yaml.mjs';

/** The shape of modules/kernel/hook-input.yaml. */
export interface HookInputLimits {
  readonly minInputWindowMs: number;
  readonly maxBytes: number;
  readonly outputTimeoutMs: number;
  readonly verdictTimeoutMs: number;
  readonly teardownTimeoutMs: number;
  readonly hookTimeoutSeconds: number;
}

/** The shared hook lifetime and input limits, read from their protected contract. */
export const HOOK_INPUT_LIMITS: Readonly<HookInputLimits> = Object.freeze(parseYaml(fs.readFileSync(new URL('../../modules/kernel/hook-input.yaml', import.meta.url), 'utf8')));
