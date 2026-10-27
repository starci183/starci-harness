// Canonical platform templates can own shared application failures as well as runtime findings.
// A catalog entry stays current only when production code instantiates its genuine DomainError enum member.
import path from 'node:path';

const CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const exported = (t, node) => node.modifiers?.some((modifier) => modifier.kind === t.SyntaxKind.ExportKeyword);
const textName = (t, node) => node && (t.isIdentifier(node) || t.isStringLiteralLike(node)) ? node.text : null;

/** An import path resolves inside the virtual backend source tree declared by the pattern files. */
function sourceTarget(specifier, owner, sources) {
  let target = null;
  if (specifier.startsWith('@modules/')) target = `src/modules/${specifier.slice('@modules/'.length)}`;
  else if (specifier.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(owner), specifier));
  if (target === null) return null;
  return [target, `${target}.ts`, `${target}/index.ts`].find((candidate) => sources.has(candidate)) ?? null;
}

/** Index module bindings and explicit exports without importing or running a template. */
function moduleInfo(t, name, entry) {
  const source = t.createSourceFile(name, entry.text, t.ScriptTarget.Latest, true, t.ScriptKind.TS);
  const info = { name, file: entry.file, source, imports: new Map(), namespaces: new Map(), locals: new Map(), exports: new Map(), shadows: new Set() };
  for (const statement of source.statements) {
    if (t.isImportDeclaration(statement)) indexImport(t, info, statement);
    if (t.isExportDeclaration(statement)) indexExport(t, info, statement);
    if ((t.isEnumDeclaration(statement) || t.isClassDeclaration(statement)) && statement.name) {
      const key = statement.name.text;
      info.locals.set(key, statement);
      if (exported(t, statement)) info.exports.set(key, { local: key });
    }
  }
  const visit = (node) => {
    const binding = scopedBinding(t, node);
    if (binding) info.shadows.add(binding);
    t.forEachChild(node, visit);
  };
  visit(source);
  return info;
}

/** A nested declaration makes a text-only binding ambiguous; it cannot supply catalog evidence. */
function scopedBinding(t, node) {
  const named = t.isVariableDeclaration(node) || t.isParameter(node) || t.isBindingElement(node)
    || t.isClassDeclaration(node) || t.isEnumDeclaration(node) || t.isFunctionDeclaration(node);
  if (!named || !node.name || !t.isIdentifier(node.name)) return null;
  let scope = node.parent;
  while (scope && !t.isSourceFile(scope)) {
    if (t.isBlock(scope) || t.isFunctionLike(scope)) return node.name.text;
    scope = scope.parent;
  }
  return null;
}

function indexImport(t, info, statement) {
  const bindings = statement.importClause?.namedBindings;
  if (!bindings || !t.isStringLiteralLike(statement.moduleSpecifier)) return;
  const specifier = statement.moduleSpecifier.text;
  if (t.isNamespaceImport(bindings)) info.namespaces.set(bindings.name.text, specifier);
  else for (const binding of bindings.elements) info.imports.set(binding.name.text, { name: (binding.propertyName ?? binding.name).text, specifier });
}

function indexExport(t, info, statement) {
  const clause = statement.exportClause;
  if (!clause || !t.isNamedExports(clause)) return;
  const specifier = statement.moduleSpecifier && t.isStringLiteralLike(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
  for (const binding of clause.elements) {
    const name = (binding.propertyName ?? binding.name).text;
    info.exports.set(binding.name.text, specifier ? { name, specifier } : { local: name });
  }
}

/** Only a declared binding or a named import/export can establish an error family or enum identity. */
function localValue(info, name, modules, seen = new Set()) {
  const identity = `${info.name}:${name}`;
  if (seen.has(identity) || info.shadows.has(name)) return null;
  const visited = new Set(seen).add(identity);
  if (info.locals.has(name)) return { info, declaration: info.locals.get(name) };
  const binding = info.imports.get(name);
  return binding ? importedValue(info, binding, modules, visited) : null;
}

function importedValue(info, binding, modules, seen) {
  const target = sourceTarget(binding.specifier, info.name, modules);
  const owner = target && modules.get(target);
  const identity = owner && `export:${owner.name}:${binding.name}`;
  if (!owner || seen.has(identity)) return null;
  const visited = new Set(seen).add(identity);
  const exposed = owner?.exports.get(binding.name);
  if (!exposed) return null;
  return exposed.local ? localValue(owner, exposed.local, modules, visited) : importedValue(owner, exposed, modules, visited);
}

const accessParts = (t, expression) => {
  if (t.isPropertyAccessExpression(expression) || t.isQualifiedName(expression)) {
    return { base: expression.expression ?? expression.left, member: (expression.name ?? expression.right).text };
  }
  if (t.isElementAccessExpression(expression) && t.isStringLiteralLike(expression.argumentExpression)) return { base: expression.expression, member: expression.argumentExpression.text };
  return null;
};

function expressionValue(t, info, expression, modules) {
  if (t.isIdentifier(expression)) return localValue(info, expression.text, modules);
  const access = accessParts(t, expression);
  const specifier = access && t.isIdentifier(access.base) && !info.shadows.has(access.base.text) && info.namespaces.get(access.base.text);
  return specifier ? importedValue(info, { specifier, name: access.member }, modules, new Set()) : null;
}

/** DomainError is the canonical imported base, not an identically named local class. */
function domainBase(t, info, expression) {
  if (!t.isIdentifier(expression)) return false;
  const binding = info.imports.get(expression.text);
  return !info.shadows.has(expression.text) && binding?.name === 'DomainError' && binding.specifier === '@modules/platform/errors';
}

/** The generic enum on the real DomainError base owns the family's permitted codes. */
function errorEnum(t, value, modules) {
  const node = value?.declaration;
  if (!node || !t.isClassDeclaration(node) || node.members.some(t.isConstructorDeclaration)) return null;
  const clause = node.heritageClauses?.find((item) => item.token === t.SyntaxKind.ExtendsKeyword);
  const base = clause?.types[0];
  const argument = base?.typeArguments?.[0];
  if (!base || !domainBase(t, value.info, base.expression) || base.typeArguments?.length !== 1 || !argument || !t.isTypeReferenceNode(argument)) return null;
  const enumeration = expressionValue(t, value.info, argument.typeName, modules);
  return enumeration && t.isEnumDeclaration(enumeration.declaration) ? enumeration : null;
}

/** A static code field survives only when no later spread or dynamic key can replace it. */
function codeField(t, expression) {
  if (!expression || !t.isObjectLiteralExpression(expression)) return null;
  let code = null;
  for (const property of expression.properties) {
    if (t.isSpreadAssignment(property) || textName(t, property.name) === null) code = null;
    else if (textName(t, property.name) === 'code') code = t.isPropertyAssignment(property) ? property.initializer : null;
  }
  return code;
}

/** Constructor and code expression must resolve to the same declared enum, including through public barrels. */
function constructedCode(t, info, node, modules) {
  const family = errorEnum(t, expressionValue(t, info, node.expression, modules), modules);
  const field = codeField(t, node.arguments?.[0]);
  const access = field && accessParts(t, field);
  const enumeration = access && expressionValue(t, info, access.base, modules);
  if (!family || !enumeration || enumeration.declaration !== family.declaration) return null;
  const member = family.declaration.members.find((item) => textName(t, item.name) === access.member);
  return member?.initializer && t.isStringLiteralLike(member.initializer) && CODE.test(member.initializer.text) ? member.initializer.text : null;
}

/** Actual typed error constructions in declared production platform templates, with their source locations. */
export function templateErrorCodes(t, sources) {
  const modules = new Map([...sources].map(([name, entry]) => [name, moduleInfo(t, name, entry)]));
  const emitted = new Map();
  for (const info of modules.values()) {
    const visit = (node) => {
      const code = t.isNewExpression(node) && constructedCode(t, info, node, modules);
      if (code) emitted.set(code, { code, file: info.file, line: info.source.getLineAndCharacterOfPosition(node.getStart(info.source)).line + 1 });
      t.forEachChild(node, visit);
    };
    visit(info.source);
  }
  return [...emitted.values()];
}
