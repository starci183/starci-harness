/** Adds backend class-validator input bounds to the emitted GraphQL contract. */
import { boundsOf, INPUT_BOUND_ARGUMENTS, INPUT_BOUNDS_DIRECTIVE, INPUT_BOUNDS_VERSION, INPUT_BOUNDS_VERSION_ARGUMENT, validateBoundType } from './input-bounds.mjs';

const ARGUMENTS = Object.keys(INPUT_BOUND_ARGUMENTS);

function graphqlShape(type) {
  const written = String(type);
  if (written.endsWith('!')) return graphqlShape(type.ofType);
  if (written.startsWith('[')) return { type: 'array', items: graphqlShape(type.ofType) };
  if (type.name === 'Int' || type.name === 'Float') return { type: 'number' };
  if (type.name === 'String' || type.name === 'ID' || type.getValues) return { type: 'string' };
  return { type: null };
}

/** A bound must constrain the field or the exact collection-item type class-validator receives. */
function validateFieldBounds(type, bounds, where) {
  const shape = graphqlShape(type);
  for (const key of Object.keys(bounds)) {
    const each = key.startsWith('item');
    if (each && !shape.items) throw new Error(`${where}: each:true bounds require an array`);
    const plainKey = each ? `${key[4].toLowerCase()}${key.slice(5)}` : key;
    validateBoundType((each ? shape.items : shape).type, plainKey, where);
  }
}

function inputFields(inputs, input) {
  const fields = new Map();
  let target = input.target;
  while (target && target !== Function.prototype) {
    for (const property of inputs.get(target)?.properties ?? []) {
      if (!fields.has(property.schemaName)) fields.set(property.schemaName, property.name);
    }
    target = Object.getPrototypeOf(target);
  }
  return fields;
}

function boundedFields(input, type, fields, validators) {
  const bounded = new Map();
  for (const [name, field] of Object.entries(type.getFields())) {
    const propertyName = fields.get(name);
    const where = `${input.name}.${name}`;
    if (propertyName === undefined) throw new Error(`${where}: cannot resolve backend input property`);
    const bounds = boundsOf(validators.filter(validator => validator.propertyName === propertyName), where);
    validateFieldBounds(field.type, bounds, where);
    if (Object.keys(bounds).length) bounded.set(name, bounds);
  }
  return bounded;
}

/** Bounds by schema input name and schema field name, using Nest's class/property names only to find validators. */
export function graphqlInputBounds({ schema, typeStorage, validationStorage }) {
  const inputs = new Map(typeStorage.getInputTypesMetadata().map(input => [input.target, input]));
  const result = new Map();
  const names = new Set();
  for (const input of inputs.values()) {
    const type = schema.getType(input.name);
    if (!type?.getFields) continue;
    if (names.has(input.name)) throw new Error(`${input.name}: duplicate backend input type name`);
    names.add(input.name);
    const validators = validationStorage.getTargetValidationMetadatas(input.target, '', false, false);
    const bounded = boundedFields(input, type, inputFields(inputs, input), validators);
    if (bounded.size) result.set(input.name, bounded);
  }
  return result;
}

/** Adds directive AST nodes without changing the schema's types, fields or ordering. */
export function withInputBounds(document, bounds) {
  if (!bounds.size && !document.definitions.some(definition => definition.kind === 'InputObjectTypeDefinition')) return document;
  const nameNode = value => ({ kind: 'Name', value });
  const definitions = document.definitions.map(definition => {
    const fields = definition.kind === 'InputObjectTypeDefinition' ? bounds.get(definition.name.value) : null;
    if (!fields) return definition;
    return { ...definition, fields: definition.fields.map(field => {
      const limits = fields.get(field.name.value);
      if (!limits) return field;
      const args = ARGUMENTS.filter(name => limits[name] !== undefined).map(name => {
        const value = limits[name];
        const integer = INPUT_BOUND_ARGUMENTS[name] === 'Int';
        if (integer && value > 2147483647) throw new Error(`${definition.name.value}.${field.name.value}: ${name} exceeds GraphQL Int`);
        return { kind: 'Argument', name: nameNode(name), value: { kind: integer ? 'IntValue' : 'FloatValue', value: String(value) } };
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
  if (definitions.some(item => item.kind === 'DirectiveDefinition' && item.name.value === INPUT_BOUNDS_DIRECTIVE)) throw new Error(`@${INPUT_BOUNDS_DIRECTIVE} is reserved for emitted input bounds`);
  return { ...document, definitions: [definition, ...definitions] };
}
