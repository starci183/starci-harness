/** Input-bounds contract metadata and class-validator bounds for the GraphQL emitter. */
export const INPUT_BOUNDS_DIRECTIVE = 'inputBounds';
export const INPUT_BOUNDS_VERSION = 1;
export const INPUT_BOUNDS_VERSION_ARGUMENT = 'version';
export const INPUT_BOUNDS_OPENAPI_EXTENSION = 'x-input-bounds';
export const INPUT_BOUND_ARGUMENTS = Object.freeze({
  maxLength: 'Int', maxItems: 'Int', min: 'Float', max: 'Float',
  itemMaxLength: 'Int', itemMaxItems: 'Int', itemMin: 'Float', itemMax: 'Float',
});
export const JSON_SCHEMA_BOUND_KEYS = Object.freeze({ min: 'minimum', max: 'maximum' });

const VALIDATORS = {
  maxLength: ['maxLength', 'max'],
  arrayMaxSize: ['maxItems', 'max'],
  min: ['min', 'min'],
  max: ['max', 'max'],
};

/** The tightest bound of each kind, retaining whether class-validator applies it to collection items. */
export function boundsOf(validators, where) {
  const bounds = {};
  for (const validator of validators) {
    if (!Object.hasOwn(VALIDATORS, validator.name)) continue;
    const rule = VALIDATORS[validator.name];
    const [name, direction] = rule;
    const value = validator.constraints?.[0];
    if (typeof value !== 'number' || !Number.isFinite(value) || (/Length$|Items$/.test(name) && (!Number.isSafeInteger(value) || value < 0))) {
      throw new Error(`${where}: ${validator.name} needs a finite${/Length$|Items$/.test(name) ? ' nonnegative integer' : ' numeric'} bound`);
    }
    const key = validator.each ? `item${name[0].toUpperCase()}${name.slice(1)}` : name;
    bounds[key] = bounds[key] === undefined ? value : direction === 'min' ? Math.max(bounds[key], value) : Math.min(bounds[key], value);
  }
  for (const prefix of ['', 'item']) {
    const key = name => prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name;
    if (bounds[key('min')] > bounds[key('max')]) throw new Error(`${where}: ${key('min')} exceeds ${key('max')}`);
  }
  return bounds;
}

/** A bound must constrain the GraphQL field's scalar or collection-item type. */
export function validateBoundType(type, key, where) {
  const expected = key === 'maxItems' ? ['array'] : key === 'min' || key === 'max' ? ['number', 'integer'] : ['string'];
  if (!expected.includes(type)) throw new Error(`${where}: ${key} requires ${expected.join(' or ')}, found ${type ?? 'an unknown type'}`);
}
