// stacks.mjs - HFS_STACKS_SHAPE (R10): standard stack shape, Sonar owner and deployment runtime consistency.
//   - every tracked path under the app root's `.starcistacks/` is one the app.starcistacks slot allows (its `allows` list is the shape:
//     application-stacks.yaml, images/<name>/** (a customised service's image folder) and <env>/{README.md, environment.json, infra/{compose,swarm,k8s,terraform}, runtime/{config,env},
//     secrets/<slug>.enc.yaml}, and the seed levels seeds/ and <env>/seeds/); a `.enc` outside <env>/secrets/ is never allowed, `runtime/files/`, a root `DESIGN.md`,
//     `deployment.json` and `k8s/` are not in the list, so they fall out of it;
//   - the declaration (read by scripts/lib/stack-declaration.mjs, the one reader of it) states a sonar service, a local
//     Sonar is owned by the host (`stack.owner: host`, root `.claude/ext/sonar`).
// The lite overlay admits Swarm compute and its own db service. Runtime rules are shared with the stack gates.
// The declaration's quality/delivery services contract (custody, CI wiring, project keys) stays check-starcistacks's.
// HFS_BRANCH_PROFILE_INVALID (R378): the `branches` block of the declaration (readBranchProfiles of the stack-declaration reader) lowers only a polish gate
// (lint, sonar, codecov) on a branch policy/loosening.yaml branchProfiles allows, never on the default branch.
import { braceVariants, globExpression } from '../../lib/glob.mjs';
import { declaredStack, findStackDeclaration, readBranchProfiles, STACK_ROOT, text } from '../../lib/stack-declaration.mjs';
import { found } from './read.mjs';
import { hostCrontabFindings, stacksRuntimeFindings } from './stacks-runtime.mjs';
import type { Parsed, Resolver } from './rule-types.mjs';

const STACKS_SHAPE = 'HFS_STACKS_SHAPE';
export const BRANCH_PROFILE_INVALID = 'HFS_BRANCH_PROFILE_INVALID';
const STACKS_SLOT = 'app.starcistacks';
const HOST_SONAR_ROOT = '.claude/ext/sonar';
const INSIDE_SECRETS = /^[^/]+\/secrets\/[^/]+\.enc(?:\.yaml)?$/;
/** The folders of .starcistacks/ that are no environment, each with what it holds: the one list every stack check reads. */
export const RESERVED_STACK_FOLDERS: ReadonlyMap<string, string> = new Map([['cache', 'the committed check cache'], ['images', 'the image folders of the services the app customises'], ['seeds', 'the shared seed level']]);

/** The anchored expressions of a slot's `allows` entries: `<name>` is one path segment, braces alternate. */
const allowedExpressions = (allows: Parsed) => allows.flatMap((entry: Parsed) => braceVariants(entry.replace(/<[a-z][a-z0-9-]*>/g, '*'))).map((variant: Parsed) => globExpression(variant.endsWith('/') ? `${variant}**` : variant));

const shapeFinding = (file: string, message: string, extra?: Parsed) => found(STACKS_SHAPE, file, message, extra);

function treeFindings(files: string[], allowed: Parsed, prefix: string) {
  const findings = [];
  // `cache` is reserved: .starcistacks/cache/ is the committed check cache (slot app.starcistacks.cache), written by the CLI, not an environment.
  for (const file of files.filter((f: Parsed) => f.startsWith(prefix) && !f.startsWith(`${prefix}cache/`))) {
    const rel = file.slice(prefix.length);
    if (/\.enc(?:\.yaml)?$/.test(rel) && !INSIDE_SECRETS.test(rel)) findings.push(shapeFinding(file, `${file} is a sealed secret outside <env>/secrets/<slug>.enc.yaml; move it to .starcistacks/<env>/secrets/`));
    else if (!allowed.some((expression: Parsed) => expression.test(rel))) findings.push(shapeFinding(file, `${file} is not part of the standard .starcistacks shape (application-stacks.yaml, images/<name>/ and <env>/{README.md, environment.json, infra, runtime/{config,env}, secrets/<slug>.enc.yaml}, and the seed levels seeds/ and <env>/seeds/ with their seeds.yaml, sql/, data/ and files/); move or delete it`));
  }
  return findings;
}

function declarationFindings(files: string[], prefix: string, declaration: Parsed) {
  const declared = `${prefix}application-stacks.yaml`;
  if (!files.includes(declared)) return [];
  const findings = [];
  const environments = declaration.doc?.environments;
  for (const [name, holds] of RESERVED_STACK_FOLDERS) {
    if (environments !== null && typeof environments === 'object' && Object.hasOwn(environments, name)) findings.push(shapeFinding(declared, `${declared} declares an environment named ${name}; the name is reserved for ${holds} (.starcistacks/${name}/)`));
  }
  if (declaration.error) return [shapeFinding(declared, `${declared} cannot be read: ${declaration.error}`)];
  for (const problem of readBranchProfiles(declaration.doc).problems) findings.push(found(BRANCH_PROFILE_INVALID, declared, `${declared} ${problem.at}: ${problem.message}`));
  const services = declaration.doc?.services;
  if (services === undefined || typeof services.sonar !== 'object' || services.sonar === null) {
    findings.push(shapeFinding(declared, `${declared} declares no sonar service; every repository states its Sonar owner (a local one is owned by the host: stack.owner host, root ${HOST_SONAR_ROOT})`));
    return findings;
  }
  for (const [id, entry] of Object.entries<Parsed>(services)) {
    const stack = declaredStack(entry);
    if (id === 'sonar' && text(entry?.mode) === 'local' && !(stack?.hostOwned && stack.root === HOST_SONAR_ROOT)) {
      findings.push(shapeFinding(declared, `${declared} services.sonar is a local Sonar but is not owned by the host; declare stack.owner host with root ${HOST_SONAR_ROOT}`));
    }
  }
  return findings;
}

/** The shape findings of the `.starcistacks` tree at the app root (`repoRoot` is the app root, `files` its own tracked paths). */
export function stacksFindings({ repoRoot, files, resolver }: { repoRoot: string; files: string[]; resolver: Resolver }) {
  const slot = resolver.slot(STACKS_SLOT);
  if (!slot) return [];
  const prefix = `${STACK_ROOT}/`;
  const declaration = findStackDeclaration(repoRoot);
  return [
    ...treeFindings(files, allowedExpressions(slot.allows ?? []), prefix),
    ...declarationFindings(files, prefix, declaration),
    ...hostCrontabFindings({ repoRoot, files }),
    ...(declaration.doc ? stacksRuntimeFindings({ repoRoot, files, doc: declaration.doc, edition: resolver.repo?.edition }) : []),
  ];
}
