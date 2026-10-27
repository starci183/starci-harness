import fs from 'node:fs';
import { INPUT_BOUND_ARGUMENTS, INPUT_BOUNDS_DIRECTIVE, INPUT_BOUNDS_VERSION, INPUT_BOUNDS_VERSION_ARGUMENT, INPUT_BOUNDS_OPENAPI_EXTENSION, JSON_SCHEMA_BOUND_KEYS } from './input-bounds.mjs';
import { byCodeUnit } from '../report/order.mjs';

const READER = `/** One field's backend bounds, including each-item validators. */\ntype InputBoundField = Readonly<Partial<Record<${Object.keys(INPUT_BOUND_ARGUMENTS).map(key => JSON.stringify(key)).join(' | ')}, number | undefined>>>\n\n${fs.readFileSync(new URL('./form-bounds-reader.ts.partial', import.meta.url), 'utf8')}`;
const graphqlBoundsText = inputs => `/** Backend input bounds, generated from the contract. */\nexport const INPUT_BOUNDS = ${JSON.stringify(inputs, null, 2)} as const\n\n${READER}`;

/** Clears generated GraphQL form limits when the last backend schema snapshot is removed. */
export function emptyInputBoundsSource() {
  return graphqlBoundsText({});
}

const inputTypes = schema => Object.values(schema.getTypeMap()).filter(type => type.astNode?.kind === 'InputObjectTypeDefinition');

function requireGraphqlBoundsFormat(schema, label = 'GraphQL contract') {
  if (inputTypes(schema).length === 0) return;
  const directive = schema.getDirective(INPUT_BOUNDS_DIRECTIVE);
  const args = new Map((directive?.args ?? []).map(argument => [argument.name, argument]));
  const version = args.get(INPUT_BOUNDS_VERSION_ARGUMENT);
  const argumentsMatch = Object.entries(INPUT_BOUND_ARGUMENTS).every(([name, type]) => String(args.get(name)?.type) === type);
  if (version?.defaultValue !== INPUT_BOUNDS_VERSION || String(version?.type) !== 'Int' ||
      args.size !== Object.keys(INPUT_BOUND_ARGUMENTS).length + 1 || !argumentsMatch) {
    throw new Error(`${label}: missing or unsupported input-bounds metadata; run starci app emit with matching HFS/CLI versions`);
  }
}

function fieldBounds(type, field) {
  const directives = field.astNode?.directives?.filter((item) => item.name.value === INPUT_BOUNDS_DIRECTIVE) ?? [];
  if (directives.length === 0) return null;
  const label = `${type.name}.${field.name}`;
  if (directives.length !== 1) throw new Error(`${label}: duplicate ${INPUT_BOUNDS_DIRECTIVE} directive`);
  const bounds = {};
  for (const argument of directives[0].arguments ?? []) {
    const name = argument.name.value;
    const scalar = INPUT_BOUND_ARGUMENTS[name];
    const value = Number(argument.value.value);
    const numeric = argument.value.kind === 'IntValue' || argument.value.kind === 'FloatValue';
    if (name === INPUT_BOUNDS_VERSION_ARGUMENT) {
      if (argument.value.kind !== 'IntValue' || value !== INPUT_BOUNDS_VERSION) throw new Error(`${label}: unsupported input-bounds version`);
      continue;
    }
    if (!Object.hasOwn(INPUT_BOUND_ARGUMENTS, name) || !numeric || !Number.isFinite(value) ||
        (scalar === 'Int' && (!Number.isSafeInteger(value) || value < 0))) {
      throw new Error(`${label}: invalid input bound ${name}`);
    }
    if (Object.hasOwn(bounds, name)) throw new Error(`${label}: duplicate input bound ${name}`);
    bounds[name] = value;
  }
  if (Object.keys(bounds).length === 0) throw new Error(`${label}: empty ${INPUT_BOUNDS_DIRECTIVE} directive`);
  return Object.fromEntries(Object.entries(bounds).sort(([a], [b]) => byCodeUnit(a, b)));
}

/**
 * GraphQL Code Generator plugin: derives typed form limits from the emitted input-field directives.
 * Generate beside the wire types and import through the API owner. Legacy or unsupported metadata refuses generation;
 * forms apply all carried limits from their translated zod refinements without importing backend code.
 */
export function inputBoundsPlugin(schema) {
  requireGraphqlBoundsFormat(schema);
  const inputs = {};
  for (const type of inputTypes(schema).sort((a, b) => byCodeUnit(a.name, b.name))) {
    const fields = {};
    for (const field of Object.values(type.getFields()).sort((a, b) => byCodeUnit(a.name, b.name))) {
      const bounds = fieldBounds(type, field);
      if (bounds !== null) fields[field.name] = bounds;
    }
    inputs[type.name] = fields;
  }
  return graphqlBoundsText(inputs);
}

/** Refuses differing bounds on shared input names before Codegen merges multiple service schemas. */
export function assertCompatibleInputBounds(schemas) {
  const seen = new Map();
  for (const [service, schema] of Object.entries(schemas)) {
    requireGraphqlBoundsFormat(schema, service);
    for (const type of inputTypes(schema)) {
      for (const field of Object.values(type.getFields())) {
        const key = `${type.name}.${field.name}`;
        const bounds = JSON.stringify(fieldBounds(type, field));
        const prior = seen.get(key);
        if (prior && prior.bounds !== bounds) throw new Error(`conflicting input bounds for ${key}: ${prior.service} and ${service}`);
        seen.set(key, { service, bounds });
      }
    }
  }
}

function mergeBounds(target, source) {
  for (const [name, value] of Object.entries(source)) {
    if (!Number.isFinite(value) || (INPUT_BOUND_ARGUMENTS[name] === 'Int' && (!Number.isSafeInteger(value) || value < 0))) {
      throw new Error(`invalid OpenAPI input bound ${name}`);
    }
    const previous = target[name];
    target[name] = previous === undefined ? value : name.toLowerCase().includes('min') ? Math.max(previous, value) : Math.min(previous, value);
  }
  return target;
}

function schemaBounds(schema, components, seen = new Set()) {
  if (!schema || typeof schema !== 'object') throw new Error('an OpenAPI property needs a schema');
  if (seen.has(schema)) return {};
  const next = new Set([...seen, schema]);
  const bounds = {};
  if (schema.$ref) {
    const prefix = '#/components/schemas/';
    const name = schema.$ref.startsWith(prefix) ? schema.$ref.slice(prefix.length).replaceAll('~1', '/').replaceAll('~0', '~') : null;
    if (name === null || !Object.hasOwn(components, name)) throw new Error(`unresolved OpenAPI input reference ${schema.$ref}`);
    mergeBounds(bounds, schemaBounds(components[name], components, next));
  }
  for (const key of Object.keys(INPUT_BOUND_ARGUMENTS).filter(name => !name.startsWith('item'))) {
    const value = schema[JSON_SCHEMA_BOUND_KEYS[key] ?? key];
    if (value !== undefined) mergeBounds(bounds, { [key]: value });
  }
  for (const part of [...(schema.allOf ?? []), ...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
    mergeBounds(bounds, schemaBounds(part, components, next));
  }
  const itemSchemas = [...(schema.prefixItems ?? []), ...(schema.items ? [schema.items] : [])];
  if (itemSchemas.length) {
    const items = {};
    for (const item of itemSchemas) mergeBounds(items, schemaBounds(item, components, next));
    for (const [name, value] of Object.entries(items)) {
      const key = `item${name[0].toUpperCase()}${name.slice(1)}`;
      if (Object.hasOwn(INPUT_BOUND_ARGUMENTS, key)) mergeBounds(bounds, { [key]: value });
    }
  }
  return Object.fromEntries(Object.entries(bounds).sort(([a], [b]) => byCodeUnit(a, b)));
}

/**
 * Generates REST_INPUT_BOUNDS from emitted OpenAPI contracts, keyed by service, DTO and property.
 * REST-only forms use the API owner's generated module. Union constraints are conservatively intersected;
 * unresolved references and malformed limits refuse generation rather than retaining stale client limits.
 */
export function openApiBoundsSource(contracts) {
  const services = {};
  for (const [service, document] of Object.entries(contracts).sort(([a], [b]) => byCodeUnit(a, b))) {
    if (document.openapi !== '3.1.0' || !document.components?.schemas) throw new Error(`${service}: expected an emitted OpenAPI 3.1 contract`);
    if (document[INPUT_BOUNDS_OPENAPI_EXTENSION] !== INPUT_BOUNDS_VERSION) {
      throw new Error(`${service}: missing or unsupported input-bounds metadata; run starci app emit with matching HFS/CLI versions`);
    }
    const inputs = {};
    const components = document.components.schemas;
    for (const [name, schema] of Object.entries(components).sort(([a], [b]) => byCodeUnit(a, b))) {
      const fields = {};
      for (const [property, definition] of Object.entries(schema.properties ?? {}).sort(([a], [b]) => byCodeUnit(a, b))) {
        const bounds = schemaBounds(definition, components);
        if (Object.keys(bounds).length) fields[property] = bounds;
      }
      if (schema.type === 'object' || schema.properties) inputs[name] = fields;
    }
    if (Object.keys(inputs).length) services[service] = inputs;
  }
  return `/** Backend input bounds, generated from OpenAPI contracts. */\nexport const REST_INPUT_BOUNDS = ${JSON.stringify(services, null, 2)} as const\n\n${READER}`;
}
