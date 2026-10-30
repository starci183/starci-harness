/** Read only the schema declarations of an operation; importing the app table never boots the app during emit. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import type TypeScript from 'typescript';

// reason: a node of the repository's TypeScript program as the compiler API hands it out: declarations are a wide union and
// each property read below sits behind the matching ts.is* guard (or a null-safe read), so one loose alias names the boundary.
type LooseNode = any;

/** The JSON Schema keywords the closed-shape proof reads; z.toJSONSchema emits the rest. */
export interface WireSchema {
  type?: string | string[];
  enum?: unknown;
  format?: string;
  readOnly?: unknown;
  properties?: Record<string, WireSchema>;
  patternProperties?: Record<string, WireSchema>;
  propertyNames?: WireSchema;
  items?: WireSchema;
  anyOf?: WireSchema[];
  oneOf?: WireSchema[];
  allOf?: WireSchema[];
  prefixItems?: WireSchema[];
  additionalProperties?: boolean | WireSchema;
  [keyword: string]: unknown;
}

/** The longest value of each fixed-format string that R305 leaves without an explicit bound; the emit publishes it as maxLength. */
const FIXED_FORMAT_MAX: Readonly<Record<string, number>> = Object.freeze({ uuid: 36, guid: 36, cuid: 25, ulid: 26, nanoid: 21, ksuid: 27, xid: 20, ipv4: 15, ipv6: 45, e164: 16 });

/** Reject schemas whose wire values remain unconstrained. */
function assertClosedShape(schema: WireSchema, location: string): void {
  if (!schema || typeof schema !== 'object' || (!schema.type && !schema.enum && !Object.hasOwn(schema, 'const') && !schema.anyOf && !schema.oneOf && !schema.allOf)) {
    throw new Error(`${location}: an open schema (any or unknown) is not an operation wire value`);
  }
  if (schema.additionalProperties === true) throw new Error(`${location}: an open object is not an operation wire value`);
  if (schema.properties && schema.additionalProperties === undefined && schema.patternProperties === undefined) {
    throw new Error(`${location}: an open object is not an operation wire value; use z.strictObject so unknown keys are refused`);
  }
}

/** A runtime bound must survive the JSON conversion; custom refinements alone cannot publish a bounded contract. */
function assertEmittedBounds(schema: WireSchema, location: string): void {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const bounded = (keyword: string) => {
    const value = schema[keyword];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  };
  if (types.includes('string') && !schema.enum && !Object.hasOwn(schema, 'const') && !bounded('maxLength')) {
    throw new Error(`${location}: the string bound must be representable as maxLength in JSON Schema`);
  }
  if (types.includes('array') && !bounded('maxItems')) throw new Error(`${location}: the array bound must be representable as maxItems in JSON Schema`);
  const dictionary = (schema.additionalProperties && typeof schema.additionalProperties === 'object') || schema.patternProperties;
  if (dictionary && !bounded('maxProperties')) {
    throw new Error(`${location}: the dictionary bound must be representable as maxProperties in JSON Schema; custom refinements are not emitted by z.toJSONSchema`);
  }
}

/** The wire-bearing descendants of a JSON schema, each with an actionable field path. */
function* schemaChildren(schema: WireSchema, location: string): Generator<[WireSchema, string]> {
  for (const keyword of ['anyOf', 'oneOf', 'allOf', 'prefixItems'] as const) {
    for (const [index, child] of (schema[keyword] ?? []).entries()) yield [child, `${location}.${keyword}[${index}]`];
  }
  for (const [name, child] of Object.entries(schema.properties ?? {})) yield [child, `${location}.${name}`];
  for (const [pattern, child] of Object.entries(schema.patternProperties ?? {})) yield [child, `${location}.${pattern}`];
  if (schema.propertyNames) yield [schema.propertyNames, `${location}.key`];
  if (schema.items) yield [schema.items, `${location}[]`];
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') yield [schema.additionalProperties, `${location}.*`];
}

function assertClosedJsonSchema(schema: WireSchema, location: string): void {
  assertClosedShape(schema, location);
  assertEmittedBounds(schema, location);
  for (const [child, childLocation] of schemaChildren(schema, location)) assertClosedJsonSchema(child, childLocation);
}

/** Loads schema-only modules and converts their exported zod values with the app's own z.toJSONSchema. */
export function operationSchemaReader({ ts, program, repoRoot }: { ts: typeof TypeScript, program: TypeScript.Program, repoRoot: string }): (property: TypeScript.Symbol, label: 'input' | 'output') => WireSchema {
  const checker = program.getTypeChecker();
  const requireApp = createRequire(path.join(repoRoot, 'package.json'));
  const loaded = new Map<string, { exports: Record<string, unknown> }>();
  const actual = (symbol: LooseNode): LooseNode => symbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const unwrap = (node: LooseNode): LooseNode => {
    while (node && (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
    return node;
  };
  const initializer = (node: LooseNode, seen = new Set<LooseNode>()): LooseNode => {
    node = unwrap(node);
    if (node && (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node))) {
      const declaration = actual(checker.getSymbolAtLocation(node))?.valueDeclaration;
      const value = declaration && valueOf(declaration);
      if (value && !seen.has(declaration)) {
        seen.add(declaration);
        return initializer(value, seen);
      }
    }
    return node;
  };
  const valueOf = (property: LooseNode): LooseNode => {
    if (!property || !ts.isShorthandPropertyAssignment(property)) return property?.initializer;
    const value = actual(checker.getShorthandAssignmentValueSymbol(property));
    return value?.valueDeclaration?.initializer && !value.valueDeclaration.getSourceFile().fileName.endsWith('.schema.ts')
      ? value.valueDeclaration.initializer
      : value?.valueDeclaration?.name ?? property.name;
  };
  const schemaSymbol = (node: LooseNode, seen = new Set<LooseNode>()): TypeScript.Symbol | null => {
    node = unwrap(node);
    const symbol = node && actual(checker.getSymbolAtLocation(node));
    const declaration = symbol?.valueDeclaration;
    if (!declaration || seen.has(declaration)) return null;
    if (declaration.getSourceFile().fileName.endsWith('.schema.ts')) return symbol;
    seen.add(declaration);
    return declaration.initializer ? schemaSymbol(declaration.initializer, seen) : null;
  };
  function load(file: string): Record<string, unknown> {
    const cached = loaded.get(file);
    if (cached) return cached.exports;
    if (!file.endsWith('.schema.ts')) throw new Error(`schema dependencies must be *.schema.ts, found ${file}`);
    const source = program.getSourceFile(file)?.text ?? fs.readFileSync(file, 'utf8');
    const compiled = ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    loaded.set(file, module);
    const requireSchema = (specifier: string): unknown => {
      if (/^zod(?:\/|$)/.test(specifier)) return requireApp(specifier);
      const resolved = ts.resolveModuleName(specifier, file, program.getCompilerOptions(), ts.sys).resolvedModule?.resolvedFileName;
      if (!resolved?.endsWith('.schema.ts')) throw new Error(`schema modules may import only zod and *.schema.ts, found ${specifier} in ${file}`);
      return load(resolved);
    };
    // zod is the app's dependency, not the schema's code: it loads before the timed run, so the 1000 ms budget bounds only the
    // schema module itself (a cold zod load inside it ran past the budget on a loaded machine).
    for (const [, specifier] of compiled.matchAll(/require\("(zod(?:\/[^"]*)?)"\)/g)) requireApp(specifier!);
    new vm.Script(compiled, { filename: file }).runInNewContext({ module, exports: module.exports, require: requireSchema }, { timeout: 1000 });
    return module.exports;
  }

  return (property: TypeScript.Symbol, label: 'input' | 'output'): WireSchema => {
    const entry = initializer(valueOf(property.valueDeclaration));
    const options = entry && ts.isCallExpression(entry) ? initializer(entry.arguments[0]) : null;
    const field = options && checker.getTypeAtLocation(options).getProperty(label)?.getDeclarations()?.find((item: LooseNode) => ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item));
    const reference = field && unwrap(valueOf(field));
    if (!reference) throw new Error(`${label}: declare input and output zod schemas in *.schema.ts and pass { input, output } to query or mutation`);
    const symbol = schemaSymbol(reference);
    const declaration = symbol?.valueDeclaration;
    const sourceFile = declaration?.getSourceFile();
    if (!sourceFile?.fileName.endsWith('.schema.ts')) throw new Error(`${label}: the schema must be an exported declaration from *.schema.ts`);
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    const exported = moduleSymbol && checker.getExportsOfModule(moduleSymbol).find((item: TypeScript.Symbol) => actual(item) === symbol);
    if (!exported) throw new Error(`${label}: the schema must be exported from ${sourceFile.fileName}`);
    const schema = load(sourceFile.fileName)[exported.getName()];
    // Inline reused schemas and refuse cycles: a recursive value has no bounded wire depth, and a local $ref would point at
    // the OpenAPI document root instead of this nested schema. Unrepresentable values (Date, transforms) also fail closed.
    const json = requireApp('zod').z.toJSONSchema(schema, {
      io: label, target: 'draft-2020-12', cycles: 'throw', reused: 'inline',
      // A request property marked readOnly would tell OpenAPI clients not to send it; a fixed-format string carries its real maximum.
      override: ({ jsonSchema }: { jsonSchema: WireSchema }) => {
        if (label === 'input') delete jsonSchema.readOnly;
        const fixed = jsonSchema.format === undefined ? undefined : FIXED_FORMAT_MAX[jsonSchema.format];
        if (jsonSchema.type === 'string' && fixed && jsonSchema.maxLength === undefined) jsonSchema.maxLength = fixed;
      },
    });
    delete json.$schema;
    assertClosedJsonSchema(json, label);
    return json;
  };
}
