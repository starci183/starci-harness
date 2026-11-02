// The Sonar project key of an app: read from its stack declaration (.starcistacks/application-stacks.yaml at the app root,
// services.sonar.projects[]) when one names the app, so there is one source of the key. Only when no declaration names the app
// does sync derive the key from the project name.
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml as bundledParseYaml } from '../runtime/engine/yaml.mjs';
import { repositoryName, identityQueryEnvironment } from '../runtime/scripts/hfs/repo-identity.mjs';
import { serviceCredentialNames } from '../runtime/scripts/hfs/ci-declaration.mjs';
export { repositoryName };

// reason: the stack declaration is YAML parsed from disk; the readers below check each field they use
type Declaration = any;
type ParseYaml = (text: string) => Declaration;

/** The stack declaration, app-relative: .starcistacks sits at the app root, beside be/, fe/ and .starciwork. */
export const DECLARATION = path.join('.starcistacks', 'application-stacks.yaml');

/** The keys services.sonar declares for `repository` in a parsed declaration (empty when it declares none). */
export function declaredSonarKeys(declaration: Declaration, repository: string): string[] {
  const projects: unknown = declaration?.services?.sonar?.projects;
  if (!Array.isArray(projects)) return [];
  return projects.filter((project: { repository?: string; key?: unknown } | null) => project?.repository === repository && typeof project.key === 'string' && project.key).map((project: { key: string }) => project.key);
}

/**
 * The declared key of the app at `root`, or null when the app has no stack declaration or the declaration names none for it.
 * Two keys for one app are refused through `fail`. `parseYaml(text)` is injected; the default is the YAML parser bundled in this
 * package (the package installs with no node_modules).
 */
export async function readDeclaredSonarKey(root: string, { parseYaml, fail }: { parseYaml?: ParseYaml | undefined; fail: (message: string) => unknown }): Promise<string | null> {
  const file = path.join(root, DECLARATION);
  if (!fs.existsSync(file)) return null;
  const parse: ParseYaml = parseYaml ?? bundledParseYaml;
  const doc = parse(fs.readFileSync(file, 'utf8'));
  const repository = repositoryName(root, { env: identityQueryEnvironment(process.env, serviceCredentialNames(doc)) });
  const keys = declaredSonarKeys(doc, repository);
  if (keys.length > 1) fail(`${DECLARATION.split(path.sep).join('/')} declares ${keys.length} Sonar projects for ${repository} (${keys.join(', ')}); one app has one key`);
  return keys[0] ?? null;
}

/**
 * The quality gate the declaration names for Sonar: `{ file, qualityGate }` (file app-relative), or null when there is no
 * declaration, Sonar is disabled in it, or it declares no Sonar service. The one gate is knowledge/sonar-gate.yaml; an app names it
 * and never states thresholds of its own.
 */
export function readDeclaredSonarGate(root: string, { parseYaml }: { parseYaml?: ParseYaml | undefined } = {}): { file: string; qualityGate: string | null } | null {
  const file = path.join(root, DECLARATION);
  if (!fs.existsSync(file)) return null;
  const sonar = (parseYaml ?? bundledParseYaml)(fs.readFileSync(file, 'utf8'))?.services?.sonar;
  if (!sonar || sonar.mode === 'disabled') return null;
  return { file: path.relative(root, file).split(path.sep).join('/'), qualityGate: typeof sonar.qualityGate === 'string' ? sonar.qualityGate : null };
}

/** The quality-gate name for an app edition from the one sonar-gate document. */
export function sonarGateName(document: Declaration, edition = 'full'): string | null {
  return (edition === 'lite' ? document?.lite : document)?.gate?.name ?? null;
}
