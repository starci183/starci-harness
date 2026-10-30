/**
 * The versioned operations of an api app, read from its typed operation table and printed as OpenAPI 3.1.
 *
 * The table is the canon's one declaration of an app's operation surface (knowledge/patterns/be/api.yaml, BE-OPERATIONS-1):
 * `apps/<app>/src/operations.ts` exports `OPERATIONS`, made by `defineOperations({ "<id>@<version>": query({ input, output }) })`.
 * Input and output are exported zod schemas from *.schema.ts. Only schema modules are evaluated, never app modules; the app's
 * z.toJSONSchema carries their constraints into OpenAPI. Open schemas and unrepresentable wire values are refused; the
 * TypeScript checker separately proves closed parsed input/output types and refusal codes. A failure always names the operation.
 *
 * The wire is one route, `POST /operations`: the body is `{ operation, requestId, input }` and the answer is `{ operation, requestId,
 * outcome }`, `outcome` being `{ kind: "ok", value }` or `{ kind: "refused", code, params? }`. Each operation contributes one request
 * and one reply component carrying `x-operation: "<id>@<version>"`; the route's body and answer are the oneOf over them.
 */
import type TypeScript from 'typescript';
import { createSchemaBuilder, stable } from './type-schema.mjs';
import type { JsonSchema } from './type-schema.mjs';
import { INPUT_BOUNDS_OPENAPI_EXTENSION, INPUT_BOUNDS_VERSION } from './input-bounds.mjs';
import { operationSchemaReader } from './operation-schemas.mjs';
import type { WireSchema } from './operation-schemas.mjs';
import path from 'node:path';

/** The export of `apps/<app>/src/operations.ts` that holds the table. */
const OPERATIONS_EXPORT = 'OPERATIONS';

/** The repository-relative path of an app's operation table. */
export const operationsPath = (app: string) => `apps/${app}/src/operations.ts`;

/** The repository-relative path of an app's OpenAPI contract. */
export const openapiPath = (app: string) => `contracts/${app}/openapi.json`;

const ID = /^[a-z][A-Za-z0-9.]*@[1-9][0-9]*$/;

/** The component name stem of an operation id: `sales.policy@1` gives `sales.policy.v1`. */
const stemOf = (id: string) => id.replace('@', '.v');

/** Preserve R95 on parsed values even when an input transform still has a closed JSON wire representation. */
function assertParsedTypes(builder: ReturnType<typeof createSchemaBuilder>, member: (name: string) => TypeScript.Type, fail: (why: string) => never): void {
  for (const label of ['input', 'output'] as const) {
    const type = member(label);
    try {
      builder.schemaOf(type, `parsed ${label}`);
    } catch (error) {
      fail((error as Error).message); // not instanceof: schema modules run in a vm realm, whose errors are not this realm's Error
    }
  }
}

/** One operation of the table, with its wire schemas and closed refusal codes. */
export interface OperationRead {
  readonly id: string;
  readonly kind: 'query' | 'mutation';
  readonly input: WireSchema;
  readonly output: WireSchema;
  readonly refusal: string[];
}

/**
 * Reads the operation table of a source file of a program. Answers null when the file is not in the program; throws when it
 * exports no `OPERATIONS` or an operation is not decidable.
 */
export function readOperations({ ts, program, file, repoRoot = path.resolve(path.dirname(file), '../../..') }: { ts: typeof TypeScript, program: TypeScript.Program, file: string, repoRoot?: string }): { operations: OperationRead[], components: Record<string, JsonSchema> } | null {
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(file);
  if (!sourceFile) return null;
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  const exported = moduleSymbol ? checker.getExportsOfModule(moduleSymbol).find((symbol: TypeScript.Symbol) => symbol.getName() === OPERATIONS_EXPORT) : null;
  if (!exported) throw new Error(`${file} does not export ${OPERATIONS_EXPORT}, the app's operation table`);
  const readSchema = operationSchemaReader({ ts, program, repoRoot });
  const parsedTypes = createSchemaBuilder({ ts, checker, schemaBacked: true });
  const table = checker.getTypeOfSymbol(exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported);
  const operations: OperationRead[] = [];
  for (const prop of [...checker.getPropertiesOfType(table)].sort((a, b) => (a.getName() < b.getName() ? -1 : 1))) {
    const id = prop.getName();
    const fail: (why: string) => never = (why) => {
      throw new Error(`operation ${id}: ${why}`);
    };
    if (!ID.test(id)) fail('the key must be "<name>@<positive version>", for example "sales.policy@1"');
    if (id.length > 128) fail('the operation id exceeds the runtime envelope limit of 128 characters');
    const contract = checker.getTypeOfSymbol(prop);
    const kindSymbol = contract.getProperty('kind');
    const kindType = kindSymbol ? checker.getTypeOfSymbol(kindSymbol) : null;
    const kind = kindType?.isStringLiteral() ? kindType.value : null;
    if (kind !== 'query' && kind !== 'mutation') fail('kind must be the literal "query" or "mutation"');
    const typesProp = contract.getProperty('types');
    if (!typesProp) fail('the value is not an OperationContract (it has no types member)');
    const typesType = checker.getNonNullableType(checker.getTypeOfSymbol(typesProp));
    const member = (name: string): TypeScript.Type => {
      const symbol = typesType.getProperty(name);
      if (!symbol) fail(`the contract has no ${name} type`);
      return checker.getTypeOfSymbol(symbol);
    };
    const schema = (label: 'input' | 'output'): WireSchema => {
      try {
        return readSchema(prop, label);
      } catch (error) {
        return fail(`${label} schema: ${(error as Error).message}`);
      }
    };
    const input = schema('input');
    const output = schema('output');
    // This check never supplies emitted schemas: z.toJSONSchema remains the wire authority.
    assertParsedTypes(parsedTypes, member, fail);
    const refusalType = member('refusal');
    let refusal: string[] = [];
    if ((refusalType.flags & ts.TypeFlags.Never) === 0) {
      const members = refusalType.isUnion() ? refusalType.types : [refusalType];
      if (!members.every((each): each is TypeScript.StringLiteralType => each.isStringLiteral())) fail(`refusal must be a closed union of string literals, found ${checker.typeToString(refusalType)}`);
      refusal = members.map((each) => each.value).sort();
    }
    operations.push({ id, kind, input, output, refusal });
  }
  if (operations.length === 0) throw new Error(`${file}: ${OPERATIONS_EXPORT} declares no operation`);
  return { operations, components: {} };
}

/** The OpenAPI 3.1 document of an app's operations, as sorted-key JSON text with one final newline. */
export function openApiText({ app, operations, components }: { app: string, operations: readonly OperationRead[], components: Readonly<Record<string, JsonSchema>> }): string {
  const schemas: Record<string, JsonSchema> = { ...components };
  schemas['Operation.InvalidRequest'] = {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'kind', 'message', 'params'],
    properties: {
      code: { const: 'OPERATIONS_INVALID_REQUEST' },
      kind: { const: 'invalid' },
      message: { type: 'string', description: 'The localized canonical error message.' },
      params: { type: 'object', additionalProperties: false },
    },
  };
  const requests: JsonSchema[] = [];
  const replies: JsonSchema[] = [];
  for (const operation of operations) {
    const stem = stemOf(operation.id);
    const okOutcome = { type: 'object', required: ['kind', 'value'], properties: { kind: { const: 'ok' }, value: operation.output } };
    const refusedOutcome = { type: 'object', required: ['code', 'kind'], properties: { code: { enum: operation.refusal, type: 'string' }, kind: { const: 'refused' }, params: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } } } };
    schemas[`Operation.${stem}.Request`] = {
      type: 'object',
      additionalProperties: false,
      required: ['input', 'operation', 'requestId'],
      properties: { input: operation.input, operation: { const: operation.id }, requestId: { type: 'string', minLength: 1, maxLength: 128 } },
      'x-kind': operation.kind,
      'x-operation': operation.id,
    };
    schemas[`Operation.${stem}.Reply`] = {
      type: 'object',
      additionalProperties: false,
      required: ['operation', 'outcome', 'requestId'],
      properties: { operation: { const: operation.id }, outcome: operation.refusal.length ? { oneOf: [okOutcome, refusedOutcome] } : okOutcome, requestId: { type: 'string', minLength: 1, maxLength: 128 } },
      'x-kind': operation.kind,
      'x-operation': operation.id,
    };
    requests.push({ $ref: `#/components/schemas/Operation.${stem}.Request` });
    replies.push({ $ref: `#/components/schemas/Operation.${stem}.Reply` });
  }
  const document = {
    openapi: '3.1.0',
    [INPUT_BOUNDS_OPENAPI_EXTENSION]: INPUT_BOUNDS_VERSION,
    info: { title: `${app} operations`, version: '1' },
    'x-operations': operations.map((operation) => ({ id: operation.id, kind: operation.kind })),
    paths: {
      '/operations': {
        post: {
          operationId: 'invokeOperation',
          requestBody: { required: true, content: { 'application/json': { schema: { oneOf: requests } } } },
          responses: {
            200: { description: 'The reply of the invoked operation: its outcome is ok or a declared refusal.', content: { 'application/json': { schema: { oneOf: replies } } } },
            400: { description: 'The envelope, operation id or input failed runtime schema validation before dispatch.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Operation.InvalidRequest' } } } },
          },
        },
      },
    },
    components: { schemas },
  };
  return `${JSON.stringify(stable(document), null, 2)}\n`;
}
