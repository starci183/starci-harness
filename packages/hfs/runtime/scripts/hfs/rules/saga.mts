// saga.mts - the saga pattern of a product that declares `patterns: ["saga"]` in hfs.json (R169 to R172). A saga is a feature of the saga kind
//   be/src/features/saga/<saga>/
//     <saga>.saga.service.ts              the orchestrator: the list of its steps and optional compensations (a service, unit-tested beside it)
//     <saga>.saga-state.ts                the persisted state of a run, typed with its `status` and its `version` fence
//     steps/<step>.saga-step.ts                one step, dispatching one command, naming the event it puts on the wire
//     compensations/<step>.compensation.ts  the optional declared undo of that step, pressed by a person and run as a forward step, naming its event
//   be/src/features/saga/<saga>/transport/message/<event>.consumer.ts   the consumers that advance it, through the inbox
//   be/contracts/<service>/events.json   every event, a compensating one declaring `compensates: "<step event>"`
// Five tree checks (the slot manifest owns the paths: an undeclared saga folder is HFS_SLOT_NOT_ENABLED):
//   R169 BE_SAGA_STEP_COMPENSATION  every compensation has the step of the same name (a step needs none), and the orchestrator imports every step and compensation;
//   R170 BE_SAGA_STATE_VERSIONED    every orchestrator has its `.saga-state.ts` whose exported state type carries `status` and a numeric `version`,
//                                   and imports the fenced store of `platform/saga`;
//   R171 BE_SAGA_EVENT_CONTRACT     a step and a compensation each name their event (`readonly event = "<name>"`), both are in a contract, and the
//                                   contract of the compensation's event says it compensates the step's event;
//   R172 BE_SAGA_CONSUMER_DEDUPE    a consumer of a saga feature passes the id of the delivery (`message.eventId`) on to the command, so the inbox can dedupe it;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../../lib/package-at.mjs';
import { found, readJson, readText } from './read.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { forwardsDeliveryKey } from './saga-delivery.mjs';
import type { Parsed, Repo, Ts } from './rule-types.mjs';

const SAGA_STEP_COMPENSATION = 'BE_SAGA_STEP_COMPENSATION';
const SAGA_STATE_VERSIONED = 'BE_SAGA_STATE_VERSIONED';
const SAGA_EVENT_CONTRACT = 'BE_SAGA_EVENT_CONTRACT';
const SAGA_CONSUMER_DEDUPE = 'BE_SAGA_CONSUMER_DEDUPE';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAGA_FILE = /^be\/src\/features\/saga\/([^/]+)\/(?:(?:steps|compensations)\/)?[^/]+\.(?:saga\.service|saga-state|saga-step|compensation)\.ts$/;
const ORCHESTRATOR = /^be\/src\/features\/saga\/([^/]+)\/([^/]+)\.saga\.service\.ts$/;
const STATE = /^be\/src\/features\/saga\/([^/]+)\/([^/]+)\.saga-state\.ts$/;
const STEP = /^be\/src\/features\/saga\/([^/]+)\/steps\/([^/]+)\.saga-step\.ts$/;
const COMPENSATION = /^be\/src\/features\/saga\/([^/]+)\/compensations\/([^/]+)\.compensation\.ts$/;
const CONSUMER = /^be\/src\/features\/saga\/([^/]+)\/transport\/message\/[^/]+\.consumer\.ts$/;
const CONTRACT = /^be\/contracts\/[^/]+\/events\.json$/;
const STORE_MODULE = /(?:^|\/)platform\/saga$/;

/** The TypeScript compiler of the app (else of the runtime), or null. */
const typescriptFor = (repoRoot: string) => loadTypescript(repoRoot, HERE);

const parse = (ts: Ts, text: string) => ts.createSourceFile('saga.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** The module specifiers a source file imports or re-exports. */
function specifiersOf(ts: Ts, sourceFile: Parsed) {
  const out = [];
  for (const statement of sourceFile.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) out.push(statement.moduleSpecifier.text);
  }
  return out;
}

/** The string literal of the class property `event` (`readonly event = "order.placed"`), or null. */
function eventOf(ts: Ts, sourceFile: Parsed) {
  let name = null;
  const visit = (node: Parsed) => {
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'event' && node.initializer && ts.isStringLiteralLike(node.initializer)) name = node.initializer.text;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return name;
}

/** Whether an exported interface or type alias of the file declares `status` and a `version: number` member. */
function statesVersion(ts: Ts, sourceFile: Parsed) {
  let versioned = false;
  const memberNames = (members: Parsed) => new Map(members.filter((member: Parsed) => ts.isPropertySignature(member) && ts.isIdentifier(member.name)).map((member: Parsed) => [member.name.text, member.type]));
  for (const statement of sourceFile.statements) {
    if (!statement.modifiers?.some((modifier: Parsed) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    let members = null;
    if (ts.isInterfaceDeclaration(statement)) members = statement.members;
    else if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) members = statement.type.members;
    if (members === null) continue;
    const named: Parsed = memberNames(members);
    if (named.has('status') && named.get('version')?.kind === ts.SyntaxKind.NumberKeyword) versioned = true;
  }
  return versioned;
}

/** The sagas of the app: every folder of the saga kind (`be/src/features/saga/<saga>/`). */
const featuresOf = (files: string[]) => [...new Set(files.map((file: string) => SAGA_FILE.exec(file)?.[1]).filter((feature: Parsed) => feature !== undefined))].sort(byCodeUnit);

function filesForFeature(files: string[], pattern: Parsed, feature: Parsed) {
  return files.filter((file: string) => pattern.test(file) && pattern.exec(file)[1] === feature);
}

function featureParts(files: string[], feature: Parsed) {
  const steps = new Map(filesForFeature(files, STEP, feature).map((file: string) => [STEP.exec(file)![2], file]));
  const compensations = new Map(filesForFeature(files, COMPENSATION, feature).map((file: string) => [COMPENSATION.exec(file)![2], file]));
  const orchestrators = filesForFeature(files, ORCHESTRATOR, feature);
  const states = new Map(filesForFeature(files, STATE, feature).map((file: string) => [STATE.exec(file)![2], file]));
  return { steps, compensations, orchestrators, states };
}

function stepCompensationFindings(folder: string, steps: Parsed, compensations: Parsed, orchestrators: Parsed) {
  const findings = [];
  for (const [stem, file] of compensations) if (!steps.has(stem)) findings.push(found(SAGA_STEP_COMPENSATION, file, `${file} is a compensation of no step: ${folder}steps/${stem}.saga-step.ts does not exist; a compensation is the declared undo of the step of the same name.`, { step: stem }));
  if (orchestrators.length === 0 && (steps.size > 0 || compensations.size > 0)) findings.push(found(SAGA_STEP_COMPENSATION, folder, `${folder} holds steps or compensations but no orchestrator: add <saga>.saga.service.ts, the list of the steps and their optional compensations.`));
  return findings;
}

function orchestratorFindings(ts: Ts, repoRoot: string, orchestrator: Parsed, folder: string, steps: Parsed, compensations: Parsed, states: Parsed) {
  const text = readText(repoRoot, orchestrator);
  if (text === null) return [];
  const findings = [];
  const sourceFile = parse(ts, text);
  const imported = new Set(specifiersOf(ts, sourceFile).map((specifier) => path.posix.normalize(path.posix.join(path.posix.dirname(orchestrator), specifier))));
  for (const file of [...steps.values(), ...compensations.values()]) {
    if (!imported.has(file.replace(/\.ts$/, ''))) findings.push(found(SAGA_STEP_COMPENSATION, orchestrator, `${orchestrator} does not list ${file}: the orchestrator imports every step and every compensation of its saga, so a step nobody runs cannot hide.`, { step: file }));
  }
  const stem = ORCHESTRATOR.exec(orchestrator)![2];
  const stateFile = states.get(stem);
  if (stateFile === undefined) findings.push(found(SAGA_STATE_VERSIONED, orchestrator, `${orchestrator} has no ${folder}${stem}.saga-state.ts: the persisted state of a run is typed there, with its status and its version fence.`, { saga: stem }));
  if (!specifiersOf(ts, sourceFile).some((specifier) => STORE_MODULE.test(specifier))) findings.push(found(SAGA_STATE_VERSIONED, orchestrator, `${orchestrator} does not use the fenced store of platform/saga: a run is persisted and moved only through it (every transition names the version it read), never by a write of its own.`, { saga: stem }));
  return findings;
}

function stateFindings(ts: Ts, repoRoot: string, states: Parsed) {
  const findings = [];
  for (const [stem, file] of states) {
    const text = readText(repoRoot, file);
    if (text !== null && !statesVersion(ts, parse(ts, text))) findings.push(found(SAGA_STATE_VERSIONED, file, `${file} exports no state type with a \`status\` and a \`version: number\`; a saga run is persisted with a version, the fence that stops a zombie delivery from moving it twice.`, { saga: stem }));
  }
  return findings;
}

const STEP_EVENT = { label: 'step', action: 'puts on the wire', key: (stem: string) => `step:${stem}` };
const COMPENSATION_EVENT = { label: 'compensation', action: 'answers', key: (stem: string) => `compensation:${stem}` };

/** Findings for the steps (or compensations) that name no event or an event no vendored contract declares; fills `eventOfFile`. */
function declaredEventFindings(ts: Ts, repoRoot: string, kind: Parsed, entries: Parsed, events: Parsed, eventOfFile: Parsed) {
  const findings = [];
  for (const [stem, file] of entries) {
    const text = readText(repoRoot, file);
    const name = text === null ? null : eventOf(ts, parse(ts, text));
    eventOfFile.set(kind.key(stem), name);
    if (name === null) findings.push(found(SAGA_EVENT_CONTRACT, file, `${file} names no event: a ${kind.label} of a saga declares \`readonly event = "<name>"\`, the event of the contract it ${kind.action}.`, { step: stem }));
    else if (!events.has(name)) findings.push(found(SAGA_EVENT_CONTRACT, file, `${file} names the event "${name}", which no be/contracts/<service>/events.json declares; every event of a saga is in a vendored contract.`, { step: stem, event: name }));
  }
  return findings;
}

/** Findings for compensation events whose contract does not name the step event it undoes, with the compensation paths found. */
function compensatesFindings(compensations: Parsed, events: Parsed, eventOfFile: Parsed) {
  const findings = [];
  const compensationPaths = [];
  for (const [stem, file] of compensations) {
    const compensationEvent = eventOfFile.get(COMPENSATION_EVENT.key(stem));
    const stepEvent = eventOfFile.get(STEP_EVENT.key(stem));
    if (compensationEvent && stepEvent && events.has(compensationEvent) && events.get(compensationEvent).compensates !== stepEvent) {
      findings.push(found(SAGA_EVENT_CONTRACT, file, `${file}: the contract of "${compensationEvent}" (${events.get(compensationEvent).contract}) does not declare \`compensates: "${stepEvent}"\`; the failure event of a compensation says which step's event it undoes.`, { step: stem, event: compensationEvent }));
    }
    if (compensationEvent) compensationPaths.push({ file, stem, event: compensationEvent });
  }
  return { findings, compensationPaths };
}

function eventFindings(ts: Ts, repoRoot: string, steps: Parsed, compensations: Parsed, events: Parsed) {
  const eventOfFile = new Map();
  const findings = [
    ...declaredEventFindings(ts, repoRoot, STEP_EVENT, steps, events, eventOfFile),
    ...declaredEventFindings(ts, repoRoot, COMPENSATION_EVENT, compensations, events, eventOfFile),
  ];
  const compensated = compensatesFindings(compensations, events, eventOfFile);
  findings.push(...compensated.findings);
  return { findings, compensationPaths: compensated.compensationPaths };
}

function consumerFindings(ts: Ts, repoRoot: string, feature: Parsed, files: string[]) {
  const findings = [];
  for (const file of filesForFeature(files, CONSUMER, feature)) {
    const text = readText(repoRoot, file);
    if (text !== null && !forwardsDeliveryKey(ts, parse(ts, text))) findings.push(found(SAGA_CONSUMER_DEDUPE, file, `${file} is a consumer of the saga ${feature} but does not pass the delivery id (\`message.eventId\`) to every dispatched command; the saga takes every event through the inbox, so the consumer hands the id to its command.`, { feature }));
  }
  return findings;
}

function featureFindings(ts: Ts, repoRoot: string, files: string[], feature: Parsed, events: Parsed) {
  const { steps, compensations, orchestrators, states } = featureParts(files, feature);
  const folder = `be/src/features/saga/${feature}/`;
  const findings = stepCompensationFindings(folder, steps, compensations, orchestrators);
  for (const orchestrator of orchestrators) findings.push(...orchestratorFindings(ts, repoRoot, orchestrator, folder, steps, compensations, states));
  findings.push(...stateFindings(ts, repoRoot, states));
  const eventResult = eventFindings(ts, repoRoot, steps, compensations, events);
  findings.push(...eventResult.findings, ...consumerFindings(ts, repoRoot, feature, files));
  return { findings, compensationPaths: eventResult.compensationPaths };
}


/** Findings of R169 to R172 over the tracked paths `files` of the app at `repoRoot`; the scenarios are proven through R284. */
export function sagaFindings({ repoRoot, files }: { repoRoot: string; files: string[]; repo?: Repo }) {
  const features = featuresOf(files);
  if (features.length === 0) return [];
  const ts = typescriptFor(repoRoot);
  if (ts === null) return [];
  const events = new Map();
  for (const contract of files.filter((file: string) => CONTRACT.test(file))) {
    for (const [name, event] of Object.entries<Parsed>(readJson(repoRoot, contract)?.events ?? {})) events.set(name, { contract, ...event });
  }
  const findings = [];
  const compensationPaths = [];
  for (const feature of features) {
    const result = featureFindings(ts, repoRoot, files, feature, events);
    findings.push(...result.findings);
    compensationPaths.push(...result.compensationPaths);
  }
  return findings;
}
