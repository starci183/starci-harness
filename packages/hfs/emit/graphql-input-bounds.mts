/** Adds backend class-validator input bounds to the emitted GraphQL contract. */
import type { BoundValidator } from './input-bounds.mjs';
import { boundsOf, INPUT_BOUND_ARGUMENTS, INPUT_BOUNDS_DIRECTIVE, INPUT_BOUNDS_VERSION, INPUT_BOUNDS_VERSION_ARGUMENT, validateBoundType } from './input-bounds.mjs';

type BoundArgument = keyof typeof INPUT_BOUND_ARGUMENTS;
const ARGUMENTS = Object.keys(INPUT_BOUND_ARGUMENTS) as BoundArgument[];

// The schema, the type metadata and the validator storage belong to the repository under emission (its own graphql, Nest and
// class-validator), so this module reads them through the structural shapes below instead of importing their types.

/** A GraphQL type as the emitter reads it: wrappers carry `ofType`, enums `getValues`, input objects `getFields`. */
export interface GraphqlTypeLike {
  readonly name?: string;
  readonly ofType?: GraphqlTypeLike;
  readonly getValues?: unknown;
  readonly getFields?: () => Record<string, { readonly type: GraphqlTypeLike }>;
}

/** The type metadata of one input class (Nest's TypeMetadataStorage record). */
interface InputTypeMetadata {
  readonly name: string;
  readonly target: object | null;
  readonly properties?: ReadonlyArray<{ readonly schemaName: string; readonly name: string }>;
}

/** Nest's type metadata storage, as far as the input bounds read it. */
export interface TypeStorageLike {
  getInputTypesMetadata(): InputTypeMetadata[];
}

/** class-validator's metadata storage, as far as the input bounds read it. */
export interface ValidationStorageLike {
  getTargetValidationMetadatas(target: object | null, targetSchema: string, always: boolean, strictGroups: boolean): BoundValidator[];
}

/** A name node of a GraphQL document. */
interface NameNode { readonly kind: 'Name'; readonly value: string }

/** A field of an input object definition in the printed document. */
interface FieldNode {
  readonly name: NameNode;
  readonly directives?: readonly object[] | undefined;
  readonly [key: string]: unknown;
}

/** A definition of the printed document; input object definitions carry fields. */
interface DefinitionNode {
  readonly kind: string;
  readonly name: NameNode;
  readonly fields?: readonly FieldNode[];
  readonly [key: string]: unknown;
}

/** The parsed document the bounds are added to. */
export interface DocumentLike {
  readonly definitions: readonly DefinitionNode[];
}

/** The bound arguments of the input fields: schema input name, then schema field name. */
export type InputBoundsMap = Map<string, Map<string, Record<string, number>>>;

/** What a field's type constrains: a scalar kind, or an array of one. */
interface BoundShape {
  readonly type: 'array' | 'number' | 'string' | null;
  readonly items?: BoundShape;
}

function graphqlShape(type: GraphqlTypeLike): BoundShape {
  const written = String(type);
  if (written.endsWith('!')) return graphqlShape(type.ofType!);
  if (written.startsWith('[')) return { type: 'array', items: graphqlShape(type.ofType!) };
  if (type.name === 'Int' || type.name === 'Float') return { type: 'number' };
  if (type.name === 'String' || type.name === 'ID' || type.getValues) return { type: 'string' };
  return { type: null };
}

/** A bound must constrain the field or the exact collection-item type class-validator receives. */
function validateFieldBounds(type: GraphqlTypeLike, bounds: Record<string, number>, where: string): void {
  const shape = graphqlShape(type);
  for (const key of Object.keys(bounds)) {
    const each = key.startsWith('item');
    if (each && !shape.items) throw new Error(`${where}: each:true bounds require an array`);
    const plainKey = each ? `${key.charAt(4).toLowerCase()}${key.slice(5)}` : key;
    validateBoundType((each ? shape.items : shape)?.type, plainKey, where);
  }
}

function inputFields(inputs: Map<object | null, InputTypeMetadata>, input: InputTypeMetadata): Map<string, string> {
  const fields = new Map<string, string>();
  let target = input.target;
  while (target && target !== Function.prototype) {
    for (const property of inputs.get(target)?.properties ?? []) {
      if (!fields.has(property.schemaName)) fields.set(property.schemaName, property.name);
    }
    target = Object.getPrototypeOf(target);
  }
  return fields;
}

function boundedFields(input: InputTypeMetadata, type: GraphqlTypeLike & Required<Pick<GraphqlTypeLike, 'getFields'>>, fields: Map<string, string>, validators: readonly BoundValidator[]): Map<string, Record<string, number>> {
  const bounded = new Map<string, Record<string, number>>();
  for (const [name, field] of Object.entries(type.getFields())) {
    const propertyName = fields.get(name);
    const where = `${input.name}.${name}`;
    if (propertyName === undefined) throw new Error(`${where}: cannot resolve backend input property`);
    const bounds = boundsOf(validators.filter((validator) => validator.propertyName === propertyName), where);
    validateFieldBounds(field.type, bounds, where);
    if (Object.keys(bounds).length) bounded.set(name, bounds);
  }
  return bounded;
}

/** Bounds by schema input name and schema field name, using Nest's class/property names only to find validators. */
export function graphqlInputBounds({ schema, typeStorage, validationStorage }: { schema: { getType(name: string): GraphqlTypeLike | undefined | null }, typeStorage: TypeStorageLike, validationStorage: ValidationStorageLike }): InputBoundsMap {
  const inputs = new Map(typeStorage.getInputTypesMetadata().map((input): [object | null, InputTypeMetadata] => [input.target, input]));
  const result: InputBoundsMap = new Map();
  const names = new Set<string>();
  for (const input of inputs.values()) {
    const type = schema.getType(input.name);
    if (!type?.getFields) continue;
    const inputType = type as typeof type & Required<Pick<GraphqlTypeLike, 'getFields'>>; // narrowed by the check above
    if (names.has(input.name)) throw new Error(`${input.name}: duplicate backend input type name`);
    names.add(input.name);
    const validators = validationStorage.getTargetValidationMetadatas(input.target, '', false, false);
    const bounded = boundedFields(input, inputType, inputFields(inputs, input), validators);
    if (bounded.size) result.set(input.name, bounded);
  }
  return result;
}

/** Adds directive AST nodes without changing the schema's types, fields or ordering. */
export function withInputBounds(document: DocumentLike, bounds: InputBoundsMap): DocumentLike {
  if (!bounds.size && !document.definitions.some(definition => definition.kind === 'InputObjectTypeDefinition')) return document;
  const nameNode = (value: string): NameNode => ({ kind: 'Name', value });
  const definitions = document.definitions.map((definition): DefinitionNode => {
    const fields = definition.kind === 'InputObjectTypeDefinition' ? bounds.get(definition.name.value) : null;
    if (!fields) return definition;
    return { ...definition, fields: (definition.fields ?? []).map((field): FieldNode => {
      const limits = fields.get(field.name.value);
      if (!limits) return field;
      const args = ARGUMENTS.flatMap((name) => {
        const value = limits[name];
        if (value === undefined) return [];
        const integer = INPUT_BOUND_ARGUMENTS[name] === 'Int';
        if (integer && value > 2147483647) throw new Error(`${definition.name.value}.${field.name.value}: ${name} exceeds GraphQL Int`);
        return [{ kind: 'Argument', name: nameNode(name), value: { kind: integer ? 'IntValue' : 'FloatValue', value: String(value) } }];
      });
      return { ...field, directives: [...(field.directives ?? []), { kind: 'Directive', name: nameNode(INPUT_BOUNDS_DIRECTIVE), arguments: args }] };
    }) };
  });
  const definition = {
    kind: 'DirectiveDefinition', name: nameNode(INPUT_BOUNDS_DIRECTIVE), repeatable: false,
    arguments: [
      { kind: 'InputValueDefinition', name: nameNode(INPUT_BOUNDS_VERSION_ARGUMENT), type: { kind: 'NamedType', name: nameNode('Int') }, defaultValue: { kind: 'IntValue', value: String(INPUT_BOUNDS_VERSION) }, directives: [] },
      ...ARGUMENTS.map(name => ({ kind: 'InputValueDefinition', name: nameNode(name), type: { kind: 'NamedType', name: nameNode(INPUT_BOUND_ARGUMENTS[name]) }, directives: [] })),
    ],
    locations: [nameNode('INPUT_FIELD_DEFINITION')],
  };
  if (definitions.some((item) => item.kind === 'DirectiveDefinition' && item.name.value === INPUT_BOUNDS_DIRECTIVE)) throw new Error(`@${INPUT_BOUNDS_DIRECTIVE} is reserved for emitted input bounds`);
  return { ...document, definitions: [definition, ...definitions] };
}
