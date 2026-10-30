// R300 FE_PUBLIC_BUILD_ARG_MISSING: every required browser build value has a Dockerfile ARG default or a buildArgs name in every environment deploying that app; literal fallback reads are optional.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../../lib/package-at.mjs';
import { parseDockerfile, words } from '../../lib/dockerfile.mjs';
import { parseYaml } from '../../../engine/yaml.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { found, readText } from './read.mjs';
import type { Parsed, Repo, Ts } from './rule-types.mjs';

export const FE_PUBLIC_BUILD_ARG_MISSING = 'FE_PUBLIC_BUILD_ARG_MISSING';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = /^NEXT_PUBLIC_[A-Z0-9_]+$/u;
const SOURCE = /\.[cm]?[jt]sx?$/u;
const SCHEMA = /(?:^|[/.-])(?:env|schema)(?:[/.-]|$)/u;
const DECLARATION = '.starcistacks/application-stacks.yaml';

function declarationOf(root: string) {
  try { return parseYaml(readText(root, DECLARATION) ?? '') ?? {}; } catch { return {}; }
}

/** Parentheses and TypeScript assertions do not alter whether a read has a literal fallback. */
function unwrappedParent(ts: Ts, node: Parsed) {
  let current = node;
  while (current.parent && (ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent) || ts.isNonNullExpression(current.parent))) current = current.parent;
  return current;
}

function literalFallback(ts: Ts, node: Parsed) {
  const current = unwrappedParent(ts, node);
  const parent = current.parent;
  if (!parent || !ts.isBinaryExpression(parent) || parent.left !== current) return false;
  const fallback = parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || parent.operatorToken.kind === ts.SyntaxKind.BarBarToken;
  return fallback && ts.isStringLiteralLike(parent.right);
}

function publicRead(ts: Ts, node: Parsed) {
  if (!ts.isPropertyAccessExpression(node) || !PUBLIC.test(node.name.text)) return null;
  const owner = node.expression;
  const env = ts.isIdentifier(owner) && owner.text === 'env';
  const processEnv = ts.isPropertyAccessExpression(owner) && owner.name.text === 'env' && ts.isIdentifier(owner.expression) && owner.expression.text === 'process';
  return env || processEnv ? node.name.text : null;
}

function optionalSchema(ts: Ts, node: Parsed) {
  if (!node) return false;
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    if (['optional', 'default', 'catch', 'nullish'].includes(node.expression.name.text)) return true;
    return optionalSchema(ts, node.expression.expression);
  }
  return false;
}

function schemaKey(ts: Ts, node: Parsed) {
  if (!ts.isPropertyAssignment(node) && !ts.isPropertySignature(node)) return null;
  const prop: Parsed = node;
  const name = prop.name?.text;
  if (!PUBLIC.test(name ?? '') || prop.questionToken || optionalSchema(ts, prop.initializer)) return null;
  return name;
}

function sourceRequirements(ts: Ts, file: string, text: string) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const required = new Set();
  const schema = SCHEMA.test(file);
  const visit = (node: Parsed) => {
    const name = publicRead(ts, node);
    if (name && !literalFallback(ts, node)) required.add(name);
    const key = schema ? schemaKey(ts, node) : null;
    if (key) required.add(key);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return required;
}

/** JSON/YAML environment schemas declare required names explicitly; optional properties impose no build requirement. */
function schemaRequirements(text: string) {
  let schema;
  try { schema = parseYaml(text); } catch { return []; }
  const names: Parsed[] = [];
  const visit = (value: Parsed) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.required)) names.push(...value.required.filter((name: string) => typeof name === 'string' && PUBLIC.test(name)));
    Object.values(value).forEach(child => { if (child && typeof child === 'object') visit(child); });
  };
  visit(schema);
  return names;
}

function requiredNames(root: string, files: string[], app: Parsed, ts: Ts) {
  const prefix = `fe/apps/${app}/`;
  const names = new Set<string>();
  for (const file of files.filter((file: string) => file.startsWith(prefix))) {
    const local = file.slice(prefix.length);
    const source = SOURCE.test(local) && (local.startsWith('src/') || local.startsWith('next.config.') || SCHEMA.test(local));
    const schema = SCHEMA.test(local) && /\.(?:json|ya?ml)$/u.test(local);
    if (!source && !schema) continue;
    const text = readText(root, file);
    if (text === null) continue;
    const required = source ? sourceRequirements(ts, local, text) : schemaRequirements(text);
    for (const name of required) names.add(name);
  }
  return [...names].sort(byCodeUnit);
}

function dockerDefaults(text: string) {
  return new Set(parseDockerfile(text).instructions.filter((item: Parsed) => item.keyword === 'ARG')
    .flatMap((item: Parsed) => words(item.text)).filter((word: string) => word.includes('='))
    .map((word: string) => word.slice(0, word.indexOf('='))));
}

function missingForEnvironment(environment: Parsed, app: Parsed, required: Parsed) {
  const images = Object.values<Parsed>(environment?.deploy?.images ?? {}).filter(image => image?.app === app);
  if (!images.length) return [];
  return required.filter((name: string) => images.some(image => {
    const args = image.buildArgs ?? {};
    return !Object.hasOwn(args.values ?? {}, name) && !(args.sealed?.keys ?? []).includes(name);
  }));
}

function appFindings(context: Parsed, app: Parsed, environments: Parsed, ts: Ts) {
  const { repoRoot, files } = context;
  const file = `fe/apps/${app}/Dockerfile`;
  if (!files.includes(file)) return [];
  const defaults = dockerDefaults(readText(repoRoot, file) ?? '');
  const required = requiredNames(repoRoot, files, app, ts).filter(name => !defaults.has(name));
  const missing = Object.entries(environments).flatMap(([environment, entry]) => {
    const names = missingForEnvironment(entry, app, required);
    return names.length ? [{ environment, names }] : [];
  });
  if (!missing.length) return [];
  const detail = missing.map(entry => `${entry.environment}: ${entry.names.join(', ')}`).join('; ');
  return [found(FE_PUBLIC_BUILD_ARG_MISSING, file, `${FE_PUBLIC_BUILD_ARG_MISSING}: ${file} requires public build values without ARG defaults or deploy image buildArgs (${detail}).`, { missing })];
}

/** Judge front-end Dockerfiles at the app root in both editions; only names are read, and sealed members are never opened. */
export function feBuildArgsFindings({ repoRoot, files = [], all = files, repo, isRoot = true }: { repoRoot: string; files?: string[]; all?: string[]; repo: Repo; isRoot?: boolean }) {
  if (!repoRoot || !isRoot || !repo?.sides?.fe) return [];
  const ts = loadTypescript(repoRoot, HERE);
  if (!ts) return [];
  const environments = declarationOf(repoRoot).environments ?? {};
  return repo.sides.fe.apps.flatMap((app: Parsed) => appFindings({ repoRoot, files: all }, app.name, environments, ts));
}
