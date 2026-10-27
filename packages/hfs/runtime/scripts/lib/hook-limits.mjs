import fs from 'node:fs';
import { parseYaml } from '../../engine/yaml.mjs';

/** The shared hook lifetime and input limits, read from their protected contract. */
export const HOOK_INPUT_LIMITS = Object.freeze(parseYaml(fs.readFileSync(new URL('../../modules/kernel/hook-input.yaml', import.meta.url), 'utf8')));
