// starcistacks-form.mjs - where a secret may live, per repository kind: the example form and the product form of a Sonar declaration (docs/application-stacks.md, "Where a secret may live").
// An example is an app inside the public runtime repository, which holds no secret file: it declares SonarCloud (provider sonarcloud, mode hosted) and names the variables of the runtime's untracked
// secret.env it reads (runtimeSecrets: the token only; the organization is configuration, config.yaml sonar.organization), with no stack, no host.local and no custody credential. A product keeps its own custody and declares no runtimeSecrets. The refusals are STACKS_EXAMPLE_FORM
// and STACKS_PRODUCT_FORM (scripts/gates/starcistacks.mjs calls this module for each enabled service).
import path from 'node:path';

/** A finding recorder: `add(level, code, where, message)`. */
export type AddFinding = (level: string, code: string, where: string, message: string) => void;
/** A custody reference of a declared service, resolved to presence (never a value). */
export interface ServiceCredential {
  id: string | null; env: string | null; key: string | null; purpose: string | null;
  custody: { repository: string | null; path: string | null; resolved: boolean; file: string | null; encPresent: boolean | null; plainPresent: boolean | null };
}
/** A declared stack resolved to its host or repository directory. */
export interface ServiceStack {
  owner: string | null; repository: string | null; root: string | null; environment: string | null; compose: string | null; container: string | null; publishedBy: string | null;
  hostOwned: boolean; repo: string | null; dir: string | null; composeFile: string | null;
}
/** One declared service as normalize reads it from the stack declaration. */
export interface StackServiceEntry {
  id: string; organization: string | null; provider: string | null; mode: string | null; purpose: string | null; reason: string | null; auth: string | null; qualityGate: string | null;
  host: { local: string | null; public: string | null; fromCredential: string | null };
  stack: ServiceStack | null;
  projects: Array<{ repository: string | null; key: string | null; name: string | null }>;
  credentials: ServiceCredential[];
  runtimeSecrets: string[];
  ci: {
    token: string | null; hostVar: string | null; organizationVar: string | null; wiring: string | null; workflow: string | null; permissions: string[];
    secrets: Array<{ name: string | null; credential: string | null }>; vars: Array<{ name: string | null; value: string | null }>; provisioning: string | null;
  };
  ownerAction: 'none' | { needed: string | null; reason: string | null } | null;
}

const EXAMPLE_NAMES = Object.freeze(['SONAR_TOKEN']);

/** 'example' for an app that lives inside the runtime repository (its checkout sits under the runtime's examples/), else 'product'. */
export function kindOf(repo: string, examplesRoot: string): 'example' | 'product' {
  const relative = path.relative(path.resolve(examplesRoot), repo);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? 'example' : 'product';
}

/** Refuse the form of the other kind in one normalized Sonar service: `add(level, code, where, message)` records a finding. */
export function checkSecretForm(service: StackServiceEntry, id: string, at: string, kind: string, add: AddFinding): void {
  if (id !== 'sonar' || service.mode === 'disabled') return;
  if (kind === 'product') {
    if (service.runtimeSecrets.length) add('refuse', 'STACKS_PRODUCT_FORM', `${at}.runtimeSecrets`, 'runtimeSecrets name variables of the runtime repository secret.env, which a product does not read; a product declares its credentials in its own custody');
    return;
  }
  const wrong = [service.stack && 'a stack', service.host.local && 'host.local', service.credentials.length && 'custody credentials'].filter(Boolean);
  if (wrong.length) add('refuse', 'STACKS_EXAMPLE_FORM', at, `an example of the runtime repository declares ${wrong.join(', ')}; the runtime repository holds no secret file, so an example declares provider sonarcloud, mode hosted and runtimeSecrets [${EXAMPLE_NAMES.join(', ')}]`);
  if (service.provider !== 'sonarcloud' || service.mode !== 'hosted') add('refuse', 'STACKS_EXAMPLE_FORM', `${at}.provider`, 'an example of the runtime repository is analysed on SonarCloud: provider sonarcloud and mode hosted');
  if (service.runtimeSecrets.join() !== EXAMPLE_NAMES.join()) add('refuse', 'STACKS_EXAMPLE_FORM', `${at}.runtimeSecrets`, `an example names the one secret.env variable it reads: runtimeSecrets [${EXAMPLE_NAMES.join(', ')}]; the SonarCloud organization is configuration (config.yaml sonar.organization), not a secret`);
}
