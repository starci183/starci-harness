// ci-custody.mts - R296-R298: CI declarations, sealed app keys and workflow reads agree by consumer, without decrypting or contacting GitHub.
import fs from 'node:fs';
import { list } from '../../lib/list.mjs';
import { findStackDeclaration, STACK_ROOT } from '../../lib/stack-declaration.mjs';
import { readCiDeclaration, sealedKeyNames, workflowReferences, ciNamesOfServices, serviceBindings, boundSealedKey, runtimeGranted, serviceCredentialNames, type ServiceBinding } from '../ci-declaration.mjs';
import { repositoryName, identityQueryEnvironment } from '../repo-identity.mjs';
import { found } from './read.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

const DECLARATION = `${STACK_ROOT}/application-stacks.yaml`;
const named = <T extends { name: unknown }>(entry: T): entry is T & { name: string } => typeof entry.name === 'string' && /^[A-Z][A-Z0-9_]*$/.test(entry.name);
const identity = (kind: string, name: string) => `${kind}:${name}`;
const atCi = (section: Parsed) => `${DECLARATION}#ci.${section}`;
/** The variables the managed workflows themselves read; an app declares none of them. STARCI_DEPLOY_PAUSED is the brake of the automatic deploy, set per GitHub environment by the owner. */
const MANAGED_VARIABLES = ['STARCI_DEPLOY_PAUSED'];

/** Whether a service declares the owner step that provisions its credential as still open (`ownerAction: {needed: <text>}`). */
const ownerStepOpen = (doc: Parsed, service: string): boolean => {
  const action = doc?.services?.[service]?.ownerAction;
  return typeof action === 'object' && action !== null && typeof action.needed === 'string' && action.needed.trim() !== '';
};

/** A sealed CI copy has exact service/project custody; every other sealed CI key remains refused. */
function sealedFindings(ci: Parsed, sealed: Parsed, bindings: ServiceBinding[]) {
  const names = new Set([...ci.secrets, ...ci.dependabotSecrets].filter(named).map((entry) => entry.name));
  const copies = bindings.filter((binding) => names.has(binding.name));
  return sealed.filter((entry: Parsed) => (names.has(entry.key) || copies.some((binding) => binding.key === entry.key))
    && !copies.some((binding) => boundSealedKey(binding, entry))).map(({ key, file }: { key: string; file: string }) => found(
    'CI_SECRET_SEALED', file,
    `${key} is a CI secret sealed in ${file} without an exact project service binding; app runtime keys stay in their members and tooling copies name services.<id>.ci.secrets[].credential`,
  ));
}

/** Runtime declarations and grants select exact environment/member/key consumers; an unselected key is unrelated. */
function runtimeFindings(doc: Parsed, ci: Parsed, sealed: Parsed) {
  const names = new Set([...ci.secrets, ...ci.vars].filter(named).map((entry) => entry.name));
  return sealed.filter((entry: Parsed) => names.has(entry.key) && runtimeGranted(doc, entry.env, entry.member, entry.key))
    .map((entry: Parsed) => found('APP_SECRET_IN_CI', entry.file, `${entry.key} is selected by an app runtime declaration or deploy grant in ${entry.env}; keep it sealed and drop it from ci`));
}

/** Workflow reads are class-sensitive; legacy lists remain readable, but an absent ci block always signals migration once per name. */
function workflowFindings(doc: Parsed, declared: Parsed, references: Parsed) {
  const hasCi = doc.ci !== undefined;
  const allowed = new Set([...declared.map(({ kind, name }: { kind: string; name: string }) => identity(kind, name)), ...MANAGED_VARIABLES.map((name) => identity('vars', name))]);
  if (hasCi) {
    for (const entry of ciNamesOfServices(doc).filter(named)) {
      const legacy = list(doc.services?.[entry.service]?.ci?.[`${entry.kind}s`]);
      if (legacy.some((item: Parsed) => (typeof item === 'string' ? item : !item?.credential ? item?.name : null) === entry.name)) allowed.add(identity(`${entry.kind}s`, entry.name));
    }
  }
  const findings = [], seen = new Set();
  for (const { file, kind, name } of references) {
    if (allowed.has(identity(kind, name))) continue;
    const id = hasCi ? `${file}:${kind}:${name}` : name;
    if (seen.has(id)) continue;
    seen.add(id);
    findings.push(found('CI_DECLARATION_DRIFT', file,
      `${kind}.${name} is read by this workflow but is not declared in ci.${kind}; declare its name, scope and consumer in ${DECLARATION}`));
  }
  return findings;
}

/** Dependabot has its own store and consumer, so only Actions secrets and vars require a workflow read. */
function driftFindings(doc: Parsed, ci: Parsed, references: Parsed) {
  const declared = [
    ...ci.secrets.filter(named).map((entry: Parsed) => ({ ...entry, kind: 'secrets' })),
    ...ci.vars.filter(named).map((entry: Parsed) => ({ ...entry, kind: 'vars' })),
  ];
  const findings = workflowFindings(doc, declared, references);
  if (doc.ci === undefined) return findings;
  const reads = new Set(references.map(({ kind, name }: { kind: string; name: string }) => identity(kind, name)));
  for (const { kind, name, optional } of declared) {
    if (!optional && !reads.has(identity(kind, name))) findings.push(found('CI_DECLARATION_DRIFT', atCi(kind),
      `${name} is declared in ci.${kind} as non-optional but no workflow reads it; remove the declaration, mark it optional or wire its workflow consumer`));
  }
  const names = new Set(declared.map(({ kind, name }) => identity(kind, name)));
  for (const [service, entry] of Object.entries<Parsed>(doc.services ?? {})) {
    for (const binding of list<Parsed>(entry?.ci?.secrets)) {
      if (typeof binding?.credential === 'string' && !names.has(identity('secrets', binding.name))) findings.push(found('CI_DECLARATION_DRIFT', atCi('secrets'),
        `services.${service}.ci.secrets names ${binding.name}, which is not declared in ci.secrets`));
    }
    for (const [field, kind] of [['token', 'secrets'], ['hostVar', entry?.host?.fromCredential ? 'secrets' : 'vars']]) {
      const name = entry?.ci?.[field!];
      if (typeof name !== 'string' || names.has(identity(kind!, name))) continue;
      findings.push(found('CI_DECLARATION_DRIFT', atCi(kind),
        `services.${service}.ci.${field} names ${name}, which is not declared in ci.${kind}; declare the shared CI name`));
    }
  }
  return findings;
}

/** Offline CI custody findings of an app root, in both lite and full editions. */
export function ciCustodyFindings({ repoRoot, repo, isRoot }: { repoRoot: string; repo: Repo; isRoot: boolean }) {
  if (repo?.kind !== 'app' || !['lite', 'full'].some((edition) => edition === repo.edition) || isRoot === false) return [];
  const { doc } = findStackDeclaration(repoRoot);
  if (!doc) return [];
  const ci = readCiDeclaration(doc);
  const selected = serviceBindings(doc, repositoryName(repoRoot, { env: identityQueryEnvironment(process.env, serviceCredentialNames(doc)) }));
  const sealed = sealedKeyNames(repoRoot, { fs });
  const references = workflowReferences(repoRoot, { fs });
  // An unsealed credential is the open owner step its service declares (`ownerAction.needed`, a fresh scaffold's Sonar token); once it is
  // sealed the declaration must say `ownerAction: none` (STACKS_OWNER_ACTION_REDUNDANT), so custody and declaration never disagree.
  const missing = selected.bindings.filter((binding) => !sealed.some((entry) => boundSealedKey(binding, entry)) && !ownerStepOpen(doc, binding.service))
    .map((binding) => found('CI_SECRET_SEALED', binding.path, 'the selected service credential member/key is not sealed in this product custody'));
  return [...selected.problems.map((problem) => found('CI_SECRET_SEALED', `${DECLARATION}#${problem.at}`, problem.message)), ...missing,
    ...sealedFindings(ci, sealed, selected.bindings), ...runtimeFindings(doc, ci, sealed), ...driftFindings(doc, ci, references)];
}
