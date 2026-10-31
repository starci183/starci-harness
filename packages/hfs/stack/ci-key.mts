// ci-key.mjs - `starci app stack ci-key`: the owner-run side of the forced-command gate of the CI SSH key (ssh-gate.mts).
//   --print-gate              prints the text of starci-ssh-gate, to install executable as /usr/local/bin/starci-ssh-gate on the manager
//   --print-authorized-keys   prints the authorized_keys line of the CI key from its PUBLIC key file (--public-key <file>)
// Both print only their text, so they pipe straight into the owner's ssh. Nothing here reaches a server, reads a sealed member or touches a private
// key: creating, installing and rotating the key stay owner-run steps. Without a flag the verb prints the install steps.
import fs from 'node:fs';
import type { DeployConfig } from './config.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import { GATE_PATH, authorizedKeysLine, gateScript } from './ssh-gate.mjs';

/** What the verb takes. */
export interface CiKeyOptions { publicKey?: string | null | undefined; printAuthorizedKeys?: boolean | undefined; printGate?: boolean | undefined }

const lineOf = (file: string | null | undefined): string => {
  if (!file) throw refusal('STACK_USAGE', '--print-authorized-keys needs --public-key <the .pub file of the CI key>');
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { throw refusal('STACK_CI_KEY_PUBLIC', `cannot read the public key file ${file}`); }
  return authorizedKeysLine(text);
};

/** Prints the gate, the authorized_keys line or the install steps (see the top of the file). */
export async function ciKey(_ctx: StackContext, config: DeployConfig, options: CiKeyOptions = {}): Promise<ActionResult> {
  if (options.printGate === true && options.printAuthorizedKeys === true) throw refusal('STACK_USAGE', 'print the gate or the authorized_keys line, one at a time');
  if (options.printGate === true) return { ok: true, lines: [gateScript().trimEnd()], data: { gatePath: GATE_PATH } };
  if (options.printAuthorizedKeys === true) {
    const line = lineOf(options.publicKey);
    return { ok: true, lines: [line], data: { authorizedKeys: line } };
  }
  const env = config.env;
  return {
    ok: true,
    lines: [
      'the CI key reaches Docker, which is root on the manager: its authorized_keys line forces starci-ssh-gate, which admits docker system dial-stdio and the release store\'s named operations only.',
      'owner-run steps on the manager (as root; <ops> is your own ssh access):',
      `  1. starci app stack ci-key --env ${env} --print-gate | ssh <ops> 'install -m 0755 -o root -g root /dev/stdin ${GATE_PATH}'`,
      `  2. starci app stack ci-key --env ${env} --public-key <ci-key.pub> --print-authorized-keys | ssh <ops> 'cat >> ~<ci-account>/.ssh/authorized_keys'`,
      '  3. seal VPS_GATE=1 in the vps-ci member of the environment, so `stack connect` tells the deploy to use the gate (STARCI_SSH_GATE=1); remove it to go back.',
      'not yet admitted by the gate: the post-deploy tasks and the manager backup/decrypt of a stack database run free commands; keep those environments on an ungated key until they are named operations.',
    ],
    data: { gatePath: GATE_PATH },
  };
}
