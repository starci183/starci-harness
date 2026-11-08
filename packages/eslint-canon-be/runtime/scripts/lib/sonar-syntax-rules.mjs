// sonar-syntax-rules.mjs - the ESLint rules that keep a TypeScript app clear of the smells SonarCloud flagged in the example apps, judged on
// the syntax tree alone (no type information, no dependency). Both lint canons (@starci/eslint-canon-be and -fe) publish them from their
// bundled runtime copy under the names below, so a product inherits them and `starci app check --gate lint` refuses the finding before the scan sees it.
// Each message names the Sonar rule it stands for, and a rule judges the files the example scans judge: a unit or end-to-end spec is outside the
// scan (`sonar.exclusions`), so it is outside these rules. The rules that need the type checker (S1874, S6551, S7503) are borrowed from
// typescript-eslint by the canon factories; the one that needs a regex ambiguity analysis (S8786) runs in the runtime's own `sonar-rules` check.

import { MAX_PARAMETERS } from './sonar-way.mjs';

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const REPEATED = Object.freeze({
  ForStatement: ['body', 'test', 'update'],
  ForInStatement: ['body'],
  ForOfStatement: ['body'],
  WhileStatement: ['body', 'test'],
  DoWhileStatement: ['body', 'test'],
});

/** The first ancestor of `node` that is `type`-matching per `test`, stopping at a function or class boundary. */
function ancestorWithin(node, test) {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (FUNCTIONS.has(parent.type) || parent.type === 'StaticBlock') return null;
    if (test(parent, child)) return parent;
  }
  return null;
}

const repeatsChild = (loop, child) => (REPEATED[loop.type] ?? []).some((key) => loop[key] === child);

/** A loop with no condition (`for (;;)`, `while (true)`) walks pages or polls: each turn needs the one before, so it cannot be run together. */
const isEndless = (loop) => (loop.type === 'ForStatement' && loop.test === null) || (['WhileStatement', 'DoWhileStatement'].includes(loop.type) && loop.test.type === 'Literal' && loop.test.value === true);

/** S9382: an `await` inside a loop body runs one step after the other; say the sequence by name or run the independent steps together. */
const noAwaitInLoop = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: { loop: 'S9382: do not `await` inside a loop. Run independent steps together with `Promise.all`, or state the sequence by name with a helper that chains the promises (`eachInOrder` of the back end\'s `platform/primitives`).' },
  },
  create: (context) => ({
    AwaitExpression: (node) => {
      if (ancestorWithin(node, (loop, child) => repeatsChild(loop, child) && !isEndless(loop))) context.report({ node, messageId: 'loop' });
    },
  }),
};

/** S7758: `codePointAt` and `fromCodePoint` handle every code point; `charCodeAt` and `fromCharCode` stop at 16 bits. */
const preferCodePoint = {
  meta: { type: 'suggestion', schema: [], messages: { codePoint: 'S7758: use `{{ better }}` instead of `{{ worse }}`; it reads whole code points, not 16-bit halves.' } },
  create: (context) => ({
    CallExpression: (node) => {
      const callee = node.callee;
      if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return;
      const name = callee.property.name;
      if (name === 'charCodeAt') context.report({ node, messageId: 'codePoint', data: { better: 'codePointAt', worse: 'charCodeAt' } });
      else if (name === 'fromCharCode' && callee.object.type === 'Identifier' && callee.object.name === 'String') context.report({ node, messageId: 'codePoint', data: { better: 'String.fromCodePoint', worse: 'String.fromCharCode' } });
    },
  }),
};

const BACKSLASH_PAIR = '\\\\';

/** Whether the string literal only escapes backslashes: its value is its raw text with each pair read as one. */
function onlyBackslashEscapes(node) {
  const raw = node.raw;
  if (typeof node.value !== 'string' || !raw.includes(BACKSLASH_PAIR) || raw.at(-2) === '\\') return false;
  if (node.value.includes('`') || node.value.includes('${')) return false;
  return raw.slice(1, -1).replaceAll(BACKSLASH_PAIR, '\\') === node.value;
}

const KEEPS_ITS_ESCAPES = new Set(['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'TSLiteralType', 'TSExternalModuleReference', 'JSXAttribute']);

/** A property named `matcher` is read statically by Next (a template literal there kills the build), so its text keeps the escape. */
const isMatcherValue = (node) => (node.parent?.type === 'Property' && node.parent.value === node && node.parent.key?.name === 'matcher')
  || (node.parent?.type === 'ArrayExpression' && isMatcherValue(node.parent));

/** Whether the tag is `String.raw`. */
const isStringRaw = (tag) => tag.type === 'MemberExpression' && !tag.computed && tag.object.type === 'Identifier' && tag.object.name === 'String' && tag.property.type === 'Identifier' && tag.property.name === 'raw';

/** S7780: a string whose only escapes are backslashes reads better as `String.raw`; a `String.raw` template with no backslash in it needs no tag. */
const preferStringRaw = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    schema: [],
    messages: {
      raw: 'S7780: write this string with `String.raw` so its backslashes are not escaped.',
      needless: 'S7780: this `String.raw` template holds no backslash; write a plain template literal.',
    },
  },
  create: (context) => ({
    Literal: (node) => {
      if (KEEPS_ITS_ESCAPES.has(node.parent?.type) || node.parent?.type === 'ExpressionStatement' || isMatcherValue(node)) return;
      if (onlyBackslashEscapes(node)) context.report({ node, messageId: 'raw' });
    },
    TaggedTemplateExpression: (node) => {
      if (!isStringRaw(node.tag) || node.quasi.quasis.some((quasi) => quasi.value.raw.includes('\\'))) return;
      context.report({ node, messageId: 'needless', fix: (fixer) => fixer.removeRange([node.tag.range[0], node.quasi.range[0]]) });
    },
  }),
};

/** What starts a new reading context between two conditional expressions: the inner one is then a value of its own, not a branch of the outer. */
const BREAKS_NESTING = new Set(['ArrayExpression', 'ObjectExpression', 'FunctionExpression', 'ArrowFunctionExpression', 'JSXExpressionContainer']);

/** S3358: a conditional expression anywhere inside another one (a branch, a test, a call argument, a template, a cast), up to an array, object, function or JSX expression, is read inside out; name the inner one. */
const noNestedConditional = {
  meta: { type: 'suggestion', schema: [], messages: { nested: 'S3358: extract this nested conditional expression into its own statement or a named function.' } },
  create: (context) => ({
    ConditionalExpression: (node) => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (parent.type === 'ConditionalExpression') {
          context.report({ node, messageId: 'nested' });
          return;
        }
        if (BREAKS_NESTING.has(parent.type)) return;
      }
    },
  }),
};

/** Whether `void` is used on a call: the explicit discard of a promise that Sonar and no-floating-promises both accept. */
const discardsACall = (argument) => argument.type === 'CallExpression' || argument.type === 'AwaitExpression' || (argument.type === 'ChainExpression' && argument.expression.type === 'CallExpression');

/** S3735: `void` on anything but a call hides what the code does; `void principal` says nothing, `undefined` or no statement says it. */
const noVoidOperator = {
  meta: { type: 'suggestion', schema: [], messages: { void: 'S3735: remove this `void`; it discards a value the code never needed. Only `void call()` (an explicit discard of a promise) is kept.' } },
  create: (context) => ({
    UnaryExpression: (node) => {
      if (node.operator === 'void' && !discardsACall(node.argument)) context.report({ node, messageId: 'void' });
    },
  }),
};

/** S1128: an import no reference reads is removed. */
const noUnusedImport = {
  meta: { type: 'suggestion', schema: [], messages: { unused: 'S1128: remove the unused import of `{{ name }}`.' } },
  create: (context) => ({
    ImportDeclaration: (node) => {
      for (const variable of context.sourceCode.getDeclaredVariables(node)) {
        if (variable.references.length === 0) context.report({ node: variable.identifiers[0] ?? node, messageId: 'unused', data: { name: variable.name } });
      }
    },
  }),
};

/** Whether `identifier` names an import of the file that nothing else reads. */
function onlyReExported(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope?.set.has(identifier.name) === false) scope = scope.upper;
  const variable = scope?.set.get(identifier.name);
  const definition = variable?.defs[0];
  return definition?.type === 'ImportBinding' && variable.references.length === 1;
}

/** S7763: an import that is only handed on is re-exported with `export ... from`. */
const preferExportFrom = {
  meta: { type: 'suggestion', schema: [], messages: { reexport: 'S7763: use `export ... from` to re-export `{{ name }}` instead of importing it first.' } },
  create: (context) => {
    const { sourceCode } = context;
    const check = (identifier, node) => {
      if (identifier?.type === 'Identifier' && onlyReExported(sourceCode, identifier)) context.report({ node, messageId: 'reexport', data: { name: identifier.name } });
    };
    return {
      ExportNamedDeclaration: (node) => {
        if (node.source) return;
        for (const specifier of node.specifiers) check(specifier.local, specifier);
        for (const declarator of node.declaration?.declarations ?? []) if (!declarator.id.typeAnnotation) check(declarator.init, declarator);
      },
      ExportDefaultDeclaration: (node) => check(node.declaration, node),
    };
  },
};

/** The members a props type declares: [{name, node}] from a type literal, an interface body, `Readonly<...>` or an intersection of those declared in the file. */
function declaredMembers(program, type) {
  if (!type) return [];
  if (type.type === 'TSTypeLiteral') return type.members.filter((member) => !member.computed && member.key).map((member) => ({ name: member.key.name ?? member.key.value, node: member.key }));
  if (type.type === 'TSIntersectionType') return type.types.flatMap((part) => declaredMembers(program, part));
  if (type.type !== 'TSTypeReference' || type.typeName.type !== 'Identifier') return [];
  if (type.typeName.name === 'Readonly') return declaredMembers(program, type.typeArguments?.params?.[0]);
  const declaration = program.body.map((statement) => statement.declaration ?? statement).find((statement) => (statement.type === 'TSTypeAliasDeclaration' || statement.type === 'TSInterfaceDeclaration') && statement.id.name === type.typeName.name);
  if (declaration?.type === 'TSInterfaceDeclaration') return declaredMembers(program, { type: 'TSTypeLiteral', members: declaration.body.body });
  return declaredMembers(program, declaration?.typeAnnotation);
}

const keyName = (key) => (key.type === 'Identifier' ? key.name : key.value);

/** The prop names a use of the parameter variable reads, or null when it escapes whole (passed on, spread, indexed dynamically). */
function readNames(variable) {
  const names = new Set();
  for (const reference of variable.references) {
    const parent = reference.identifier.parent;
    if (parent.type === 'MemberExpression' && parent.object === reference.identifier && (!parent.computed || parent.property.type === 'Literal')) names.add(keyName(parent.property));
    else if (parent.type === 'VariableDeclarator' && parent.init === reference.identifier && parent.id.type === 'ObjectPattern' && parent.id.properties.every((property) => property.type === 'Property' && !property.computed)) parent.id.properties.forEach((property) => names.add(keyName(property.key)));
    else return null;
  }
  return names;
}

/** The names a parameter reads: an object pattern's own keys, or what its variable's uses read; null means "all of them". */
function readByParameter(sourceCode, fn, parameter) {
  if (parameter.type === 'ObjectPattern') {
    if (parameter.properties.some((property) => property.type !== 'Property' || property.computed)) return null;
    return new Set(parameter.properties.map((property) => keyName(property.key)));
  }
  if (parameter.type !== 'Identifier') return null;
  const variable = sourceCode.getDeclaredVariables(fn).find((candidate) => candidate.name === parameter.name);
  return variable ? readNames(variable) : null;
}

/** S6767: a member of a component's props type that the component never reads is removed from the type. */
const noUnusedPropTypes = {
  meta: { type: 'suggestion', schema: [], messages: { unused: 'S6767: the prop `{{ name }}` is declared in the props type but the component never reads it; remove it.' } },
  create: (context) => {
    const { sourceCode } = context;
    const frames = [];
    const enter = (node) => frames.push({ node, jsx: false });
    const markJsx = () => frames.forEach((frame) => { frame.jsx = true; });
    const exit = () => {
      const { node, jsx } = frames.pop();
      const parameter = node.params[0];
      const annotation = parameter?.typeAnnotation?.typeAnnotation;
      if (!jsx || !annotation) return;
      const read = readByParameter(sourceCode, node, parameter);
      if (read === null) return;
      for (const member of declaredMembers(sourceCode.ast, annotation)) {
        if (!read.has(member.name)) context.report({ node: member.node, messageId: 'unused', data: { name: member.name } });
      }
    };
    return { FunctionDeclaration: enter, FunctionExpression: enter, ArrowFunctionExpression: enter, 'FunctionDeclaration:exit': exit, 'FunctionExpression:exit': exit, 'ArrowFunctionExpression:exit': exit, JSXElement: markJsx, JSXFragment: markJsx };
  },
};

/** The decorators of a class whose constructor parameters are injected (Sonar's S107 spares these constructors). */
const INJECTED = new Set(['Injectable', 'Component', 'Directive', 'Pipe']);
const decoratorName = (decorator) => {
  const expression = decorator.expression.type === 'CallExpression' ? decorator.expression.callee : decorator.expression;
  return expression.type === 'Identifier' ? expression.name : null;
};
const injectedConstructor = (node) => node.parent?.type === 'MethodDefinition' && node.parent.kind === 'constructor'
  && (node.parent.parent?.parent?.decorators ?? []).some((decorator) => INJECTED.has(decoratorName(decorator)));

/** S107: a function takes at most MAX_PARAMETERS parameters; the constructor of an injectable class is a dependency list, not a call shape. */
const maxParams = {
  meta: { type: 'suggestion', schema: [], messages: { many: 'S107: this function has {{count}} parameters; at most {{max}} are allowed. Pass an options object.' } },
  create(context) {
    const check = (node) => {
      if (node.params.length > MAX_PARAMETERS && !injectedConstructor(node)) context.report({ node, messageId: 'many', data: { count: String(node.params.length), max: String(MAX_PARAMETERS) } });
    };
    return { FunctionDeclaration: check, FunctionExpression: check, ArrowFunctionExpression: check };
  },
};

/** S4084: a `<video>` or `<audio>` element plays captions: a `<track kind="captions">` child, or it is `muted`. */
const MEDIA = new Set(['video', 'audio']);
const jsxName = (node) => (node?.name?.type === 'JSXIdentifier' ? node.name.name : null);
const attributeOf = (opening, name) => opening.attributes.find((attribute) => attribute.type === 'JSXAttribute' && attribute.name?.name === name);
const isCaptionTrack = (child) => child.type === 'JSXElement' && jsxName(child.openingElement) === 'track'
  && attributeOf(child.openingElement, 'kind')?.value?.value === 'captions';
const mediaHasCaption = {
  meta: { type: 'problem', schema: [], messages: { caption: 'S4084: give this <{{ name }}> a <track kind="captions"> child (or make it muted) so it can be followed without sound.' } },
  create(context) {
    return {
      JSXElement(node) {
        const name = jsxName(node.openingElement);
        if (!MEDIA.has(name) || attributeOf(node.openingElement, 'muted') || node.children.some(isCaptionTrack)) return;
        context.report({ node: node.openingElement, messageId: 'caption', data: { name } });
      },
    };
  },
};

/** The line breaks the scanner counts and the language does not: a raw U+2028 or U+2029 inside a string, template, regular expression or comment is legal source, and U+0085 is no line terminator in it. */
const SCANNER_LINE_BREAKS = /[\u2028\u2029\u0085]/gu;
const LINE_BREAK_NAMES = Object.freeze({ '\u2028': ['U+2028', 'LINE SEPARATOR', '\\u2028'], '\u2029': ['U+2029', 'PARAGRAPH SEPARATOR', '\\u2029'], '\u0085': ['U+0085', 'NEXT LINE', '\\u0085'] });
/** Sonar scanner crash ("Line n is out of range ... File has m lines"): the scanner splits a file at U+2028, U+2029 and U+0085, the language service does not, so their line numbers disagree and the analysis aborts. Applies to every file the scan reads, specs included. */
const noLineSeparatorLiteral = {
  meta: { type: 'problem', schema: [], messages: { raw: 'The scanner splits lines at a raw {{ code }} ({{ name }}) and TypeScript does not, so its analysis aborts with "Line n is out of range". Write the escape `{{ escape }}` in a string, template or regular expression, or delete the character anywhere else.' } },
  create: (context) => ({
    Program: () => {
      const { text } = context.sourceCode;
      for (const found of text.matchAll(SCANNER_LINE_BREAKS)) {
        const [code, name, escape] = LINE_BREAK_NAMES[found[0]];
        context.report({ loc: context.sourceCode.getLocFromIndex(found.index), messageId: 'raw', data: { code, name, escape } });
      }
    },
  }),
};

/** The line width of @starci/prettier-config: a merged import longer than this is laid out one specifier a line. */
const PRINT_WIDTH = 120;
const TRAILING_BLANK = /[ \t]*\r?\n?/y;

/** S3863: one module is imported once; a value and a type from the same module are one `import { value, type Type }`. */
const noDuplicateImport = {
  meta: { type: 'suggestion', fixable: 'code', schema: [], messages: { duplicate: 'S3863: \'{{ source }}\' is imported more than once. Merge the imports into one: `import { value, type Type } from \'{{ source }}\'`.' } },
  create: (context) => {
    const { sourceCode } = context;
    const groups = new Map();
    /** The specifier list of one merged import, or null when the group cannot be merged without changing what it binds. */
    const mergedText = (group) => {
      const defaults = group.filter((declaration) => declaration.specifiers.some((specifier) => specifier.type === 'ImportDefaultSpecifier'));
      const mergeable = group.every((declaration) => (declaration.attributes?.length ?? 0) === 0 && declaration.specifiers.every((specifier) => specifier.type !== 'ImportNamespaceSpecifier'))
        && defaults.length <= 1 && defaults.every((declaration) => declaration.importKind !== 'type');
      if (!mergeable) return null;
      const allType = group.every((declaration) => declaration.importKind === 'type');
      const names = new Set();
      for (const declaration of group) {
        for (const specifier of declaration.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;
          const text = sourceCode.getText(specifier);
          names.add(declaration.importKind === 'type' && !allType && specifier.importKind !== 'type' ? `type ${text}` : text);
        }
      }
      const head = defaults[0]?.specifiers.find((specifier) => specifier.type === 'ImportDefaultSpecifier');
      const parts = [head ? sourceCode.getText(head) : null, names.size > 0 ? `{ ${[...names].join(', ')} }` : null].filter(Boolean);
      const semicolon = sourceCode.getText(group[0]).endsWith(';') ? ';' : '';
      const kind = allType ? 'type ' : '';
      const tail = ` from ${sourceCode.getText(group[0].source)}${semicolon}`;
      const single = `import ${kind}${parts.join(', ')}${tail}`;
      if (single.length <= PRINT_WIDTH || names.size === 0) return single;
      // as Prettier lays out an import that does not fit one line: one specifier a line, a trailing comma
      const lines = [...names].map((name) => `    ${name},`).join('\n');
      return `import ${kind}${head ? `${sourceCode.getText(head)}, ` : ''}{\n${lines}\n}${tail}`;
    };
    const removal = (declaration) => {
      TRAILING_BLANK.lastIndex = declaration.range[1];
      const tail = TRAILING_BLANK.exec(sourceCode.text);
      return [declaration.range[0], declaration.range[1] + (tail ? tail[0].length : 0)];
    };
    return {
      ImportDeclaration: (node) => {
        if (node.specifiers.length === 0) return;
        const key = `${String(node.source.value)}\u0000${(node.attributes ?? []).map((attribute) => sourceCode.getText(attribute)).join(',')}`;
        groups.set(key, [...(groups.get(key) ?? []), node]);
      },
      'Program:exit': () => {
        for (const group of groups.values()) {
          if (group.length < 2) continue;
          const merged = mergedText(group);
          group.slice(1).forEach((declaration, index) => {
            const fix = index === 0 && merged !== null
              ? (fixer) => [fixer.replaceText(group[0], merged), ...group.slice(1).map((later) => fixer.removeRange(removal(later)))]
              : undefined;
            context.report({ node: declaration, messageId: 'duplicate', data: { source: String(declaration.source.value) }, fix });
          });
        }
      },
    };
  },
};

/** The first non-whitespace-only children of a fragment or element: JSX trims a text of blanks that holds a line break. */
const significantChildren = (children) => children.filter((child) => !(child.type === 'JSXText' && /^\s*$/u.test(child.value) && /[\r\n]/u.test(child.value)) && !(child.type === 'JSXExpressionContainer' && child.expression.type === 'JSXEmptyExpression'));

/** Whether the opening element is a fragment: `<>` (a JSXFragment) is handled apart, this is `<Fragment>` or `<React.Fragment>`. */
const isFragmentElement = (opening) => (opening.name.type === 'JSXIdentifier' && opening.name.name === 'Fragment')
  || (opening.name.type === 'JSXMemberExpression' && opening.name.property.name === 'Fragment' && opening.name.object.type === 'JSXIdentifier');

/** S6749: a fragment that wraps nothing or one child is removed; the child stands for it. */
const noUselessFragment = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    schema: [],
    messages: {
      empty: 'S6749: remove this empty fragment.',
      single: 'S6749: this fragment wraps one child; remove the fragment and keep the child.',
    },
  },
  create: (context) => {
    const { sourceCode } = context;
    const check = (node, children) => {
      const parentIsJsx = node.parent?.type === 'JSXElement' || node.parent?.type === 'JSXFragment';
      const kept = significantChildren(children);
      if (kept.length === 0) {
        context.report({ node, messageId: 'empty' });
        return;
      }
      if (kept.length !== 1) return;
      const [only] = kept;
      if (only.type === 'JSXText' && !parentIsJsx) return;
      const fix = only.type === 'JSXElement' || only.type === 'JSXFragment' ? (fixer) => fixer.replaceText(node, sourceCode.getText(only)) : undefined;
      context.report({ node, messageId: 'single', fix });
    };
    return {
      JSXFragment: (node) => check(node, node.children),
      JSXElement: (node) => {
        if (isFragmentElement(node.openingElement) && node.openingElement.attributes.length === 0) check(node, node.children);
      },
    };
  },
};

const isUppercaseName = (name) => typeof name === 'string' && /^[A-Z]/u.test(name);

/** The name a function is bound to: its own id, or the variable that holds it directly or through `memo(...)` / `forwardRef(...)`. */
function functionName(node) {
  if (node.id?.name) return node.id.name;
  let holder = node.parent;
  while (holder?.type === 'CallExpression') holder = holder.parent;
  return holder?.type === 'VariableDeclarator' && holder.id.type === 'Identifier' ? holder.id.name : null;
}

/** S6478: a component declared inside another component is a new type on every render and remounts its subtree; declare it at module level. */
const noNestedComponent = {
  meta: { type: 'problem', schema: [], messages: { nested: 'S6478: the component `{{ name }}` is declared inside the component `{{ outer }}`, so it is a new component on every render and its state is lost. Move it to module level and pass what it reads as props.' } },
  create: (context) => {
    const frames = [];
    const enter = (node) => frames.push({ node, name: functionName(node), jsx: false, nested: [] });
    const markJsx = () => frames.forEach((frame) => { frame.jsx = true; });
    const exit = () => {
      const frame = frames.pop();
      if (isUppercaseName(frame.name) && frame.jsx) {
        const outer = [...frames].reverse().find((candidate) => isUppercaseName(candidate.name));
        outer?.nested.push(frame);
      }
      if (frame.jsx) for (const inner of frame.nested) context.report({ node: inner.node.id ?? inner.node.parent ?? inner.node, messageId: 'nested', data: { name: inner.name, outer: frame.name } });
    };
    return { FunctionDeclaration: enter, FunctionExpression: enter, ArrowFunctionExpression: enter, 'FunctionDeclaration:exit': exit, 'FunctionExpression:exit': exit, 'ArrowFunctionExpression:exit': exit, JSXElement: markJsx, JSXFragment: markJsx };
  },
};

/** S6748: children go between the tags. Where they cannot (a connected block that renders a pure component), the slot has a name of its own. */
const noChildrenProp = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      children: 'S6748: do not pass `children` as a prop; nest the content between the tags. In a connected block (`blocks/*/index.tsx`, FE_CONNECTED_BLOCK_RENDER_PAIR, FE_WORLD_OWNER_RENDER_BOUNDARY) nesting is not available: pass the slot under a prop of another name (`content`, `footer`, ...) to the pure component.',
    },
  },
  create: (context) => ({
    JSXAttribute: (node) => {
      if (node.name.type === 'JSXIdentifier' && node.name.name === 'children') context.report({ node, messageId: 'children' });
    },
    CallExpression: (node) => {
      const callee = node.callee;
      const creates = (callee.type === 'Identifier' && callee.name === 'createElement') || (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier' && callee.property.name === 'createElement');
      const props = node.arguments[1];
      if (!creates || props?.type !== 'ObjectExpression') return;
      for (const property of props.properties) {
        if (property.type === 'Property' && !property.computed && (property.key.name === 'children' || property.key.value === 'children')) context.report({ node: property, messageId: 'children' });
      }
    },
  }),
};

/** S6754: `useState` is destructured into a value and its setter, named after each other. */
const useStateDestructured = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      pair: 'S6754: destructure the `useState` result into a value and its setter: `const [value, setValue] = useState(...)`.',
      symmetric: 'S6754: name the setter after the value: `[{{ value }}, set{{ Value }}]`.',
    },
  },
  create: (context) => ({
    CallExpression: (node) => {
      const callee = node.callee;
      const isUseState = (callee.type === 'Identifier' && callee.name === 'useState') || (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier' && callee.property.name === 'useState');
      if (!isUseState || node.parent?.type !== 'VariableDeclarator' || node.parent.init !== node) return;
      const id = node.parent.id;
      if (id.type !== 'ArrayPattern' || id.elements.length !== 2) {
        context.report({ node: id, messageId: 'pair' });
        return;
      }
      const [value, setter] = id.elements;
      if (value?.type !== 'Identifier' || setter?.type !== 'Identifier') return;
      const Value = value.name.charAt(0).toUpperCase() + value.name.slice(1);
      if (setter.name !== `set${Value}`) context.report({ node: setter, messageId: 'symmetric', data: { value: value.name, Value } });
    },
  }),
};

/** The native element each ARIA role stands for: a host element with the role and another tag is written as the native one (S6819). A role with no native element, or an ambiguous one (`img` on an `svg`, `group`), is not listed. */
const NATIVE_FOR_ROLE = Object.freeze({
  status: ['output'], navigation: ['nav'], main: ['main'], article: ['article'], complementary: ['aside'], contentinfo: ['footer'], banner: ['header'],
  form: ['form'], button: ['button'], dialog: ['dialog'], figure: ['figure'], heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], link: ['a'],
  list: ['ul', 'ol', 'menu'], listitem: ['li'], progressbar: ['progress'], region: ['section'], separator: ['hr'], table: ['table'], row: ['tr'], cell: ['td'],
  columnheader: ['th'], rowheader: ['th'], checkbox: ['input'], radio: ['input'], slider: ['input'], spinbutton: ['input'], searchbox: ['input'],
  textbox: ['input', 'textarea'], option: ['option'], combobox: ['select', 'input'], term: ['dt'], definition: ['dd'],
});

/** S6819: a native element carries its role; a host element given a `role` that another native element has is that element. */
const preferTagOverRole = {
  meta: { type: 'suggestion', schema: [], messages: { tag: 'S6819: use the native <{{ tag }}> element instead of role="{{ role }}" on <{{ name }}>.' } },
  create: (context) => ({
    JSXOpeningElement: (node) => {
      if (node.name.type !== 'JSXIdentifier' || !/^[a-z]/u.test(node.name.name)) return;
      const attribute = attributeOf(node, 'role');
      const literal = attribute?.value?.type === 'JSXExpressionContainer' ? attribute.value.expression : attribute?.value;
      const role = literal?.type === 'Literal' ? literal.value : undefined;
      const tags = typeof role === 'string' ? NATIVE_FOR_ROLE[role.trim().split(/\s+/u)[0]] : undefined;
      if (tags === undefined || tags.includes(node.name.name)) return;
      context.report({ node: attribute, messageId: 'tag', data: { tag: tags[0], role: role.trim(), name: node.name.name } });
    },
  }),
};

/** The bidirectional control characters of text:S6389: they reorder the text a reader sees against the text the compiler reads. */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/gu;
/** text:S6389 (Trojan Source): a raw embedding, override, isolate or pop control character anywhere in a file, specs included, is refused. */
const noBidirectionalCharacter = {
  meta: { type: 'problem', schema: [], messages: { raw: 'A bidirectional control character ({{ code }}) reorders how this line reads. Write the escape `\\u{{{ hex }}}` inside a string, template or regular expression, or delete the character anywhere else.' } },
  create: (context) => ({
    Program: () => {
      for (const found of context.sourceCode.text.matchAll(BIDI_CONTROLS)) {
        const hex = found[0].codePointAt(0).toString(16).toUpperCase();
        context.report({ loc: context.sourceCode.getLocFromIndex(found.index), messageId: 'raw', data: { code: `U+${hex}`, hex } });
      }
    },
  }),
};

/** The files the example scans leave out: a unit spec and an end-to-end spec (the regex, and the flat-config globs of the same set). */
const OUTSIDE_THE_SCAN = /\.(?:e2e-)?spec\.[cm]?[jt]sx?$/;
export const OUTSIDE_THE_SCAN_FILES = Object.freeze(['**/*.spec.{js,mjs,cjs,ts,mts,cts,jsx,tsx}', '**/*.e2e-spec.{js,mjs,cjs,ts,mts,cts,jsx,tsx}']);

/** The rule judging only the files the scan judges. */
const scanned = (rule) => ({ ...rule, create: (context) => (OUTSIDE_THE_SCAN.test(context.filename) ? {} : rule.create(context)) });

/** The rules both canons publish, by published name (the React ones, from `no-useless-fragment` to `prefer-tag-over-role`, only the front end names). */
export const SONAR_SYNTAX_RULES = Object.freeze({
  'no-await-in-loop': scanned(noAwaitInLoop),
  'prefer-code-point': scanned(preferCodePoint),
  'prefer-string-raw': scanned(preferStringRaw),
  'no-nested-conditional': scanned(noNestedConditional),
  'no-void-operator': scanned(noVoidOperator),
  'no-unused-import': scanned(noUnusedImport),
  'prefer-export-from': scanned(preferExportFrom),
  'no-unused-prop-types': scanned(noUnusedPropTypes),
  'media-has-caption': scanned(mediaHasCaption),
  'max-params': scanned(maxParams),
  'no-line-separator-literal': noLineSeparatorLiteral,
  'no-bidirectional-character': noBidirectionalCharacter,
  'no-duplicate-import': scanned(noDuplicateImport),
  'no-useless-fragment': scanned(noUselessFragment),
  'no-nested-component': scanned(noNestedComponent),
  'no-children-prop': scanned(noChildrenProp),
  'use-state-destructured': scanned(useStateDestructured),
  'prefer-tag-over-role': scanned(preferTagOverRole),
});
