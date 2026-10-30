import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { byCodeUnit } from '../lib/list.mjs';
const runs = new AsyncLocalStorage();
/** Share compiler inputs only until this check finishes; nested callers join the same run. */
export function withTypeScriptProgramRun(run) {
    return runs.getStore() ? run() : runs.run(new Map(), run);
}
function keyOf(value) {
    if (value === undefined)
        return 'u';
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        return JSON.stringify(value);
    if (Array.isArray(value)) {
        const items = value.map(keyOf);
        return items.includes(null) ? null : `[${items.join(',')}]`;
    }
    if (typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
        return null;
    const entries = [];
    for (const name of Object.keys(value).sort(byCodeUnit)) {
        const item = keyOf(value[name]);
        if (item === null)
            return null;
        entries.push(`${JSON.stringify(name)}:${item}`);
    }
    return `{${entries.join(',')}}`;
}
/**
 * build(), shared inside a program run by every caller that asks for the same kind, compiler and input. An input that
 * is not plain data (a function, a class instance) is never shared.
 */
export function sharedInProgramRun(kind, ts, input, build) {
    const values = runs.getStore();
    const key = values ? keyOf(input) : null;
    if (key === null || !values)
        return build();
    let byKey = values.get(ts);
    if (!byKey) {
        byKey = new Map();
        values.set(ts, byKey);
    }
    const id = `${kind}\0${key}`;
    if (!byKey.has(id))
        byKey.set(id, build());
    return byKey.get(id);
}
/** ts.createProgram, shared inside a program run. */
export function createTypeScriptProgram(ts, { rootNames, options, projectReferences }) {
    return sharedInProgramRun('program', ts, { rootNames, options, projectReferences }, () => ts.createProgram({ rootNames, options, projectReferences, host: sharedSourceHost(ts, options) })); // exactOptionalPropertyTypes: the optional host and references are passed through as undefined, as before
}
function sharedSourceHost(ts, options) {
    if (!runs.getStore())
        return undefined;
    const registry = sharedInProgramRun('documents', ts, null, () => ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames, ts.sys.getCurrentDirectory()));
    const host = ts.createCompilerHost(options);
    const readSource = host.getSourceFile;
    // TypeScript's registry separates parse-affecting settings and Node module formats. Sharing syntax trees leaves
    // module resolution and symbol/type caches with each program, including projects with different path aliases.
    host.getSourceFile = (file, sourceOptions, onError, fresh) => {
        if (fresh)
            return readSource(file, sourceOptions, onError, fresh);
        let text;
        try {
            text = host.readFile(file);
        }
        catch (error) {
            onError?.(String(error.message ?? error));
            text = '';
        }
        if (text === undefined)
            return undefined;
        return registry.acquireDocument(file, options, ts.ScriptSnapshot.fromString(text), '0', undefined, sourceOptions);
    };
    return host;
}
/** Read and expand a tsconfig with the caller's TypeScript compiler and optional tracked file reader. */
export function readTypeScriptProject(ts, configFile, readFile = ts.sys.readFile) {
    const read = ts.readConfigFile(configFile, readFile);
    if (read.error)
        return { read: read, parsed: null };
    const host = readFile === ts.sys.readFile ? ts.sys : { ...ts.sys, readFile };
    return { read: read, parsed: ts.parseJsonConfigFileContent(read.config, host, path.dirname(configFile), undefined, configFile) };
}
/** Resolve a project reference with the compiler's API, including older compiler fallback. */
export function typeScriptProjectReferencePath(ts, reference) {
    if (typeof ts.resolveProjectReferencePath === 'function')
        return ts.resolveProjectReferencePath(reference);
    return path.extname(reference.path) ? reference.path : path.join(reference.path, 'tsconfig.json');
}
/** Resolve an import using the selected project's compiler options. */
export function resolveTypeScriptModule(ts, specifier, from, options, host, cache) {
    const resolverHost = host === undefined ? ts.sys : host;
    return ts.resolveModuleName(specifier, from, options, resolverHost, cache).resolvedModule?.resolvedFileName;
}
