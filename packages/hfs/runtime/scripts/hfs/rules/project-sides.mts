// project-sides.mts - R399: the sides a project declares (hfs.json `sides`, contexts/project/README.md PROJECT-1) agree with its tree and its
// stack declaration (contexts/project/stacks.md PROJECT-STACKS-2), each way:
//   HFS_SIDE_FOLDER_MISSING   a declared side (be, fe, packages) tracks no file under its folder;
//   HFS_SIDE_UNDECLARED       a tracked folder be/, fe/ or packages/ belongs to a side hfs.json does not declare;
//   STACKS_SIDES_UNDECLARED   .starcistacks/application-stacks.yaml states no `sides` (a warning: the field is how a reader of the stack
//                             learns the project's shape; `starci app scaffold` writes it);
//   STACKS_SIDES_DRIFT        its `sides` differ from the sides hfs.json declares;
//   STACKS_COMPONENT_SIDE     a component runs an app of a side the project lacks: a deploy image of an app no declared side declares, a
//                             front-end build configuration (buildArgs) without fe, a local process run from the folder of an undeclared side.
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { findStackDeclaration } from '../../lib/stack-declaration.mjs';
import { PROJECT_SIDES, sideDeclared, type ProjectSide } from '../project-sides.mjs';
import { found } from './read.mjs';
import type { Finding, Parsed, Repo } from './rule-types.mjs';

const STACK_FILE = '.starcistacks/application-stacks.yaml';
/** The image a lite app builds from .starcistacks/images/db, not from a side. */
const STACK_OWN_IMAGES = new Set(['db']);

const mapping = (value: unknown): Record<string, Parsed> => (plain(value) ? value as Record<string, Parsed> : {});

/** The apps the declared app sides declare. */
const declaredApps = (repo: Repo): Set<string> => new Set((['be', 'fe'] as const).filter((side) => sideDeclared(repo, side)).flatMap((side) => (repo.sides?.[side]?.apps ?? []).map((app: Parsed) => String(app.name))));

/** HFS_SIDE_FOLDER_MISSING and HFS_SIDE_UNDECLARED over the tracked tree `all` of the app root. */
export function sideFolderFindings(repo: Repo, all: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (const side of PROJECT_SIDES) {
    const tracked = all.some((file) => file.startsWith(`${side}/`));
    const declared = sideDeclared(repo, side);
    if (declared && !tracked) findings.push(found('HFS_SIDE_FOLDER_MISSING', `${side}/`, `hfs.json declares the ${side} side, but no file is tracked under ${side}/: track the side's tree, or remove sides.${side} from hfs.json (PROJECT-1)`, { side }));
    if (!declared && tracked) findings.push(found('HFS_SIDE_UNDECLARED', `${side}/`, `${side}/ is tracked, but hfs.json does not declare the ${side} side: declare it under sides (${side === 'packages' ? '"packages": {}' : `"${side}": { "apps": [...] }`}), or remove the folder (PROJECT-1)`, { side }));
  }
  return findings;
}

/** STACKS_SIDES_UNDECLARED, STACKS_SIDES_DRIFT and STACKS_COMPONENT_SIDE over a parsed stack declaration. Pure. */
export function stackSideFindings(repo: Repo, doc: Parsed): Finding[] {
  if (!plain(doc)) return [];
  const findings: Finding[] = [];
  const expected = Object.fromEntries(PROJECT_SIDES.map((side) => [side, sideDeclared(repo, side)])) as Record<ProjectSide, boolean>;
  const stated = doc.sides;
  if (stated === undefined) findings.push({ ...found('STACKS_SIDES_UNDECLARED', STACK_FILE, `the stack declaration states no sides: add \`sides: ${JSON.stringify(expected).replaceAll('"', '').replaceAll(',', ', ').replaceAll(':', ': ')}\`, the sides hfs.json declares (PROJECT-STACKS-2)`), level: 'warning' });
  else {
    const off = PROJECT_SIDES.filter((side) => !plain(stated) || stated[side] !== expected[side]);
    if (off.length) findings.push(found('STACKS_SIDES_DRIFT', STACK_FILE, `the stack declaration states sides ${JSON.stringify(stated ?? null)}, but hfs.json declares ${PROJECT_SIDES.filter((side) => expected[side]).join(', ')}: ${off.map((side) => `${side} must be ${String(expected[side])}`).join('; ')} (PROJECT-1, PROJECT-STACKS-2)`, { sides: off }));
  }
  const apps = declaredApps(repo);
  for (const [environment, spec] of Object.entries(mapping(doc.environments))) {
    const images = mapping(mapping(mapping(spec).deploy).images);
    for (const [component, image] of Object.entries(images)) {
      const app = mapping(image).app === undefined ? component : String(mapping(image).app);
      if (!apps.has(app) && !STACK_OWN_IMAGES.has(app)) findings.push(found('STACKS_COMPONENT_SIDE', STACK_FILE, `environments.${environment}.deploy.images.${component} builds the app ${app}, which no declared side declares: remove the component, or declare the side that holds the app (PROJECT-1)`, { component }));
      else if (!sideDeclared(repo, 'fe') && mapping(image).buildArgs !== undefined) findings.push(found('STACKS_COMPONENT_SIDE', STACK_FILE, `environments.${environment}.deploy.images.${component} carries front-end build configuration (buildArgs), but the project declares no fe side (PROJECT-1)`, { component }));
    }
    const processes = Array.isArray(mapping(mapping(spec).local).processes) ? mapping(mapping(spec).local).processes as Parsed[] : [];
    for (const process of processes) {
      const argv = Array.isArray(process?.argv) ? process.argv.map(String) : [];
      const side = (['be', 'fe'] as const).find((candidate) => process?.cwd === candidate || argv.includes(`dev:${candidate}`));
      if (side && !sideDeclared(repo, side)) findings.push(found('STACKS_COMPONENT_SIDE', STACK_FILE, `environments.${environment}.local.processes ${String(process?.name)} runs the ${side} side, which the project does not declare (PROJECT-1)`, { component: process?.name }));
    }
  }
  return findings;
}

/** Findings of R399 at the app root of an app. */
export function projectSidesFindings({ repoRoot, repo, isRoot, all = [] }: { repoRoot: string; repo: Repo; isRoot: boolean; all?: string[] }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false || repo.sides === undefined) return [];
  const stack = findStackDeclaration(repoRoot);
  return [...sideFolderFindings(repo, all), ...(stack.doc ? stackSideFindings(repo, stack.doc) : [])];
}
