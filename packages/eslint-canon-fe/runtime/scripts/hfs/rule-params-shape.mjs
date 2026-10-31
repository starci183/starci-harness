import { isPlainObject } from '../../engine/plain-object.mjs';
import { paramNamesOk } from './param-names.mjs';
import { kindParamProblems, scenarioProblem } from './declaration-slots.mjs';
import { NAME, namedMapValid, PACKAGE_NAME, roleListProblems, SCHEMA_AUTHORITIES, unitRolesProblems } from './manifest-shape.mjs';
import { byCodeUnit, nonemptyUniqueList } from '../lib/list.mjs';
import { ruleEditionProblems } from './edition-slots.mjs';
const PROFILES = ['be', 'fe'];
const BE_OWN = ['infraOwners', 'eventBus', 'specDoubles', 'paramNames', 'suffixes', 'bannedSuffixes', 'contractShape', 'unitRoles', 'logicRoles', 'valueRoles', 'thinRoles', 'patternScenarios', 'kindPatterns', 'addKinds', 'backing'];
const backingEntryOk = (entry) => isPlainObject(entry) && Object.keys(entry).every((key) => ['clients', 'images', 'patterns', 'editions'].includes(key))
    && nonemptyUniqueList(entry.clients, (name) => PACKAGE_NAME.test(String(name)))
    && Array.isArray(entry.patterns) && entry.patterns.every((name) => NAME.test(String(name))) && new Set(entry.patterns).size === entry.patterns.length
    && nonemptyUniqueList(entry.images, (name) => PACKAGE_NAME.test(String(name)))
    && ruleEditionProblems(entry, 'backing service').length === 0;
const FORM_NAMES = new Set(['call', 'new', 'curried', 'object', 'primitive', 'array']);
const blockOk = (v) => isPlainObject(v) && Number.isInteger(v.lines) && v.lines >= 2 && Number.isInteger(v.tokens) && v.tokens >= 1 && Object.keys(v).length === 2;
const fileLinesOk = (v) => isPlainObject(v) && Number.isInteger(v.soft) && v.soft >= 1 && typeof v.hardGrowth === 'boolean' && Object.keys(v).length === 2;
const SHARED_PARAMS = {
    fileLines: fileLinesOk,
    duplicateBlock: blockOk,
    functionLines: (v) => Number.isInteger(v) && v >= 1,
    featureFiles: (v) => Number.isInteger(v) && v >= 1,
};
const SHARED_KEYS = Object.keys(SHARED_PARAMS);
const sharedParam = (key, v) => Object.hasOwn(SHARED_PARAMS, key) && SHARED_PARAMS[key](v);
const sideOk = (side, own, extra = []) => own.every((k) => side[k] !== undefined) && Object.entries(side).every(([k, v]) => own.includes(k) || extra.includes(k) || sharedParam(k, v));
const liteKeyOk = (lite, key, keys) => key !== 'lite' && keys.includes(key)
    && (!['functionLines', 'featureFiles'].includes(key) || sharedParam(key, lite[key]));
const liteOk = (lite, keys) => lite === undefined || (isPlainObject(lite) && Object.keys(lite).length > 0 && Object.keys(lite).every((k) => liteKeyOk(lite, k, keys)));
const memberMap = (v, allowEmpty) => isPlainObject(v) && Object.keys(v).length > 0 && Object.values(v).every((list) => Array.isArray(list) && (allowEmpty || list.length > 0) && list.every((x) => /^[A-Z][A-Za-z0-9]*$/.test(String(x))) && new Set(list).size === list.length);
const roleList = (v) => nonemptyUniqueList(v, (role) => NAME.test(String(role)));
const formsOk = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => FORM_NAMES.has(x)) && new Set(v).size === v.length;
const doubleOk = (v) => isPlainObject(v) && /^[A-Za-z][A-Za-z0-9]*$/.test(String(v.double)) && formsOk(v.forms);
const regexOk = (v) => { try {
    return typeof v === 'string' && v.length > 0 && Boolean(new RegExp(v));
}
catch {
    return false;
} };
const dbExtensionsOk = (value) => Array.isArray(value) && value.every((name) => typeof name === 'string' && name.length > 0) && new Set(value).size === value.length;
const DB_PARAMS = { extensions: dbExtensionsOk };
const dbParamsOk = (db) => db === undefined || (isPlainObject(db) && Object.entries(db).every(([key, value]) => Object.hasOwn(DB_PARAMS, key) && DB_PARAMS[key](value)));
function beSpecificProblems(be, manifest) {
    const bad = [];
    bad.push(...scenarioProblem(be.patternScenarios), ...kindParamProblems(be, manifest.triggerKinds));
    if (!isPlainObject(be.contractShape) || Object.keys(be.contractShape).length !== 1 || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(be.contractShape.helper)))
        bad.push('ruleParams.be.contractShape must be {helper: <identifier>}');
    const owners = be.infraOwners;
    const ownerId = /^(platform|integrations)\/[a-z][a-z0-9-]*$/;
    if (!isPlainObject(owners) || !Object.keys(owners).length || !Object.entries(owners).every(([key, list]) => key && Array.isArray(list) && list.every((o) => ownerId.test(String(o))) && new Set(list).size === list.length))
        bad.push('ruleParams.be.infraOwners must map a non-empty specifier to a list of unique platform/<capability> or integrations/<provider> owners ([] means nowhere)');
    const eventBus = be.eventBus;
    if (!isPlainObject(eventBus) || Object.keys(eventBus).sort(byCodeUnit).join() !== 'classes,imports' || !memberMap(eventBus.imports, true) || !memberMap(eventBus.classes, false))
        bad.push('ruleParams.be.eventBus must be {imports: {<module>: [unique PascalCase members]}, classes: {<module>: [non-empty unique PascalCase classes]}}');
    if (!paramNamesOk(be.paramNames))
        bad.push('ruleParams.be.paramNames must be a non-empty list of unique {type | typeSuffix, names, nameSuffix?} entries');
    if (!namedMapValid(be.backing, backingEntryOk))
        bad.push('ruleParams.be.backing must map a backing service name to {clients: [unique package names], patterns: [unique pattern names], images: [unique image repositories], editions?: [unique known editions]}');
    if (!roleList(be.suffixes))
        bad.push('ruleParams.be.suffixes must be a non-empty list of unique kebab-case role suffixes');
    if (!roleList(be.bannedSuffixes))
        bad.push('ruleParams.be.bannedSuffixes must be a non-empty list of unique kebab-case suffixes');
    else if (roleList(be.suffixes) && be.suffixes.some((x) => be.bannedSuffixes.includes(x)))
        bad.push('ruleParams.be.suffixes and bannedSuffixes must be disjoint');
    const sd = be.specDoubles;
    if (!isPlainObject(sd) || Object.keys(sd).sort(byCodeUnit).join() !== 'doubles,fallback,kit' || typeof sd.kit !== 'string' || !sd.kit || !Array.isArray(sd.doubles) || !sd.doubles.length || !sd.doubles.every((e) => doubleOk(e) && regexOk(e.token) && (e.from === undefined || regexOk(e.from)) && Object.keys(e).length === (e.from === undefined ? 3 : 4)) || !doubleOk(sd.fallback) || Object.keys(sd.fallback).length !== 2)
        bad.push('ruleParams.be.specDoubles must be {kit, doubles: [{token: regex, double, forms}], fallback: {double, forms}} with forms drawn from call, new, curried, object, primitive, array');
    return bad;
}
/** A database function name (R334): `schema.name` outside pg_catalog, or, where `bare` admits it, a pg built-in named alone. */
const dbFunctionNameOk = (name, bare) => typeof name === 'string' && (/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(name) ? !name.startsWith('pg_catalog.') : bare && /^[a-z_][a-z0-9_]*$/.test(name));
/**
 * True for an absent list or a list of {name, reason} database functions, names unique and schema-qualified; `bare` also admits
 * a bare name, which only the canon's list (ruleParams.be.dbFunctions) uses, for the pg built-ins its helpers call.
 */
export const dbFunctionsOk = (list, { bare = false } = {}) => list === undefined || (Array.isArray(list) && list.every((entry) => isPlainObject(entry) && Object.keys(entry).sort().join() === 'name,reason' && dbFunctionNameOk(entry.name, bare) && typeof entry.reason === 'string' && entry.reason.trim().length > 0) && new Set(list.map((entry) => entry.name)).size === list.length);
/**
 * True for an absent list or a list of {file, reason} SQL pass-through files (R334): `file` is a forward-slash path relative to the
 * side folder (no leading slash, no `..`), unique, and the reason names whose text the file passes through.
 */
export const sqlPassThroughOk = (list) => list === undefined || (Array.isArray(list) && list.every((entry) => isPlainObject(entry) && Object.keys(entry).sort().join() === 'file,reason' && typeof entry.file === 'string' && /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/.test(entry.file) && !entry.file.split('/').includes('..') && typeof entry.reason === 'string' && entry.reason.trim().length > 0) && new Set(list.map((entry) => entry.file)).size === list.length);
/** The shape problems of `m.ruleParams`. */
export function ruleParamsProblems(m) {
    const bad = [];
    const rp = m.ruleParams;
    if (!isPlainObject(rp) || Object.keys(rp).some((k) => ![...PROFILES, 'common', 'db'].includes(k)) || !isPlainObject(rp.common) || !isPlainObject(rp.be) || (rp.fe !== undefined && !isPlainObject(rp.fe)))
        return ['ruleParams must be a map with common, be and optionally fe and db'];
    else {
        // common holds the parameters both sides share; a side may restate one of them (a valid value) as an override, nothing else.
        // Edition lite: a side's optional `lite` map overrides keys of the same side (never `lite` itself) when the app declares edition lite.
        if (!sideOk(rp.common, []) || !fileLinesOk(rp.common.fileLines) || !blockOk(rp.common.duplicateBlock))
            bad.push('ruleParams.common needs fileLines {soft, hardGrowth} and duplicateBlock {lines >= 2, tokens >= 1}; optional functionLines and featureFiles must be positive integers');
        if (!sideOk(rp.be, BE_OWN, ['schemaAuthority', 'lite', 'dbFunctions', 'sqlPassThrough']) || (rp.be.schemaAuthority !== undefined && !SCHEMA_AUTHORITIES.includes(rp.be.schemaAuthority)) || !dbFunctionsOk(rp.be.dbFunctions, { bare: true }) || !sqlPassThroughOk(rp.be.sqlPassThrough) || !liteOk(rp.be.lite, [...BE_OWN, ...SHARED_KEYS, 'schemaAuthority', 'dbFunctions', 'sqlPassThrough']))
            bad.push('ruleParams.be needs infraOwners, eventBus, specDoubles, paramNames, suffixes, bannedSuffixes, contractShape {helper}, unitRoles, logicRoles, thinRoles, patternScenarios, kindPatterns, addKinds and backing (shared parameters live in ruleParams.common, a side may override them); optional: schemaAuthority (' + SCHEMA_AUTHORITIES.join(' | ') + '), dbFunctions ([{name, reason}]: a pg built-in bare, every other function schema.name), sqlPassThrough ([{file, reason}]: a file whose SQL text is not written by the app) and lite (overrides of the same keys)');
        else
            bad.push(...unitRolesProblems(rp.be), ...roleListProblems(rp.be));
        bad.push(...beSpecificProblems(rp.be, m));
        if (rp.fe !== undefined && (!sideOk(rp.fe, [], ['lite']) || !liteOk(rp.fe.lite, SHARED_KEYS)))
            bad.push('ruleParams.fe may only restate the shared parameters of ruleParams.common, and carry a lite override of them');
        if (!dbParamsOk(rp.db))
            bad.push('ruleParams.db may contain only extensions (a list of unique non-empty extension names)');
    }
    return bad;
}
