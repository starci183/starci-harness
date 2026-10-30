import fs from 'node:fs';
import path from 'node:path';
function appendProjectReferences(relative, parsed, config, ts, helpers, queue, errors) {
    for (const reference of parsed.projectReferences ?? []) {
        const referencedFile = helpers.typeScriptProjectReferencePath(ts, reference);
        const absoluteReference = path.resolve(referencedFile);
        if (!helpers.isInside(config.root, absoluteReference)) {
            errors.push({ ruleId: 'ARCH_TSCONFIG_REFERENCE_OUTSIDE', project: relative, message: `Project reference leaves the repository: ${helpers.slash(path.relative(config.root, absoluteReference))}.` });
        }
        else {
            queue.push(helpers.slash(path.relative(config.root, absoluteReference)));
        }
    }
}
function readProject(relative, config, ts, helpers, state) {
    const configFile = path.join(config.root, ...relative.split('/'));
    if (!fs.existsSync(configFile)) {
        state.errors.push({ ruleId: 'ARCH_TSCONFIG_MISSING', project: relative, message: `${relative} does not exist.` });
        state.invalidProjects.add(relative);
        return;
    }
    const { read, parsed } = helpers.readTypeScriptProject(ts, configFile);
    if (parsed === null) {
        state.errors.push(helpers.compilerError(ts, config.root, read.error, relative));
        state.invalidProjects.add(relative);
        return;
    }
    if (parsed.errors.length) {
        state.errors.push(...parsed.errors.map(item => helpers.compilerError(ts, config.root, item, relative)));
        state.invalidProjects.add(relative);
        return;
    }
    appendProjectReferences(relative, parsed, config, ts, helpers, state.queue, state.errors);
    state.parsedProjects.set(relative, parsed);
}
function loadProjectConfigurations(config, ts, helpers, errors) {
    const state = { errors, parsedProjects: new Map(), invalidProjects: new Set(), queue: [...config.projects] };
    const seenProjects = new Set();
    while (state.queue.length) {
        const relative = state.queue.shift(); // length checked by the loop condition
        if (seenProjects.has(relative))
            continue;
        seenProjects.add(relative);
        readProject(relative, config, ts, helpers, state);
    }
    return state;
}
function pathMatches(config, paths, file, helpers) {
    const relative = helpers.slash(path.relative(config.root, file));
    const normalized = helpers.slash(paths).replace(/\/$/, '');
    return helpers.sameOrUnder(relative, normalized);
}
function visitProjectReferences(relative, selected, parsedProjects, config, ts, helpers) {
    if (selected.has(relative))
        return;
    selected.add(relative);
    for (const reference of parsedProjects.get(relative)?.projectReferences ?? []) {
        const referencedFile = helpers.typeScriptProjectReferencePath(ts, reference);
        const referenced = helpers.slash(path.relative(config.root, path.resolve(referencedFile)));
        if (parsedProjects.has(referenced))
            visitProjectReferences(referenced, selected, parsedProjects, config, ts, helpers);
    }
}
function invalidProjectMatches(config, paths, relative, helpers) {
    const directory = path.dirname(path.join(config.root, ...relative.split('/')));
    return paths.some(prefix => {
        const absolute = path.join(config.root, ...helpers.slash(prefix).split('/'));
        return helpers.isInside(directory, absolute);
    });
}
function selectProjects(config, paths, ts, state, helpers) {
    const selected = new Set();
    const direct = new Set();
    if (!paths.length)
        return { selected, direct };
    for (const [relative, parsed] of state.parsedProjects) {
        if (parsed.fileNames.some(file => paths.some(prefix => pathMatches(config, prefix, file, helpers)))) {
            direct.add(relative);
            visitProjectReferences(relative, selected, state.parsedProjects, config, ts, helpers);
        }
    }
    for (const relative of state.invalidProjects) {
        if (invalidProjectMatches(config, paths, relative, helpers))
            selected.add(relative);
    }
    state.errors.splice(0, state.errors.length, ...state.errors.filter(error => !error.project || selected.has(error.project)));
    return { selected, direct };
}
function createProjects(config, paths, state, selection, ts, helpers) {
    const projects = [];
    for (const [relative, parsed] of state.parsedProjects) {
        if (paths.length && !selection.selected.has(relative))
            continue;
        const rootNames = paths.length && selection.direct.has(relative)
            ? parsed.fileNames.filter(file => paths.some(prefix => pathMatches(config, prefix, file, helpers)))
            : parsed.fileNames;
        const program = helpers.createTypeScriptProgram(ts, { rootNames, options: parsed.options, projectReferences: parsed.projectReferences });
        state.errors.push(...program.getSyntacticDiagnostics().filter(item => !item.file || helpers.isInside(config.root, item.file.fileName))
            .map(item => helpers.compilerError(ts, config.root, item, relative, 'ARCH_SYNTAX_INVALID')));
        projects.push({ relative, program, options: parsed.options });
    }
    return projects;
}
function ownershipRank(config, project, file, helpers) {
    return helpers.isInside(path.dirname(path.join(config.root, ...project.relative.split('/'))), file)
        ? project.relative.split('/').length : -1;
}
function collectProjectFiles(config, projects, helpers) {
    const fileMap = new Map();
    const ownerByFile = new Map();
    // Retain only the winning source occurrence while visiting each project. Equal ranks keep the first project,
    // as does a file outside every project directory; the deepest enclosing tsconfig otherwise owns its checker.
    // Within that project the last realpath alias supplies the source, matching the compiler's occurrence order.
    for (const project of projects) {
        for (const sourceFile of project.program.getSourceFiles()) {
            if (!helpers.isProductionSource(config.root, sourceFile))
                continue;
            const name = helpers.canonical(sourceFile.fileName);
            const owner = ownerByFile.get(name);
            if (owner === project) {
                fileMap.set(name, sourceFile);
                continue;
            }
            if (owner && ownershipRank(config, owner, name, helpers) >= ownershipRank(config, project, name, helpers))
                continue;
            ownerByFile.set(name, project);
            fileMap.set(name, sourceFile);
        }
    }
    return { fileMap, ownerByFile };
}
function makeFileGraph(config, projects, helpers) {
    const { fileMap, ownerByFile } = collectProjectFiles(config, projects, helpers);
    const checkerByFile = new Map();
    for (const [name, owner] of ownerByFile)
        checkerByFile.set(name, owner.program.getTypeChecker());
    const files = [...fileMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, file]) => file);
    const edges = new Map([...fileMap.keys()].map((file) => [file, []]));
    for (const [file, sourceFile] of fileMap) {
        const sourceName = path.resolve(sourceFile.fileName);
        if (sourceName !== file)
            edges.set(sourceName, edges.get(file) ?? []);
    }
    return { fileMap, checkerByFile, ownerByFile, files, edges };
}
// Resolution entries contain failed lookup paths as well as hits. Keep only one bounded batch for the current project;
// graph edges retain the resolved targets, so rotating this scratch cache changes neither coverage nor findings.
const RESOLUTION_BATCH_SIZE = 1024;
function resolutionCache(state, project) {
    if (state.resolutionProject !== project || state.resolutionCount === RESOLUTION_BATCH_SIZE) {
        state.resolutionProject = project;
        state.resolutionCount = 0;
        state.resolutionCache = state.ts.createModuleResolutionCache(state.config.root, file => state.ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase(), project.options);
    }
    state.resolutionCount += 1;
    return state.resolutionCache;
}
function addUnprovenFindings(sourceFile, project, references, errors, config, helpers) {
    for (const item of references.unproven)
        errors.push({
            ruleId: 'ARCH_DYNAMIC_DEPENDENCY_UNPROVEN',
            project: project.relative,
            path: helpers.relativePath(config.root, sourceFile.fileName),
            ...helpers.sourceLocation(sourceFile, item.node),
            message: `${item.kind} must use a string-literal module name so architecture coverage can resolve its dependency.`,
        });
}
function unresolvedReferenceFinding(reference, sourceFile, project, config, workspaceNames, errors, helpers) {
    const codeLike = !helpers.assetExtension.test(reference.specifier);
    const workspaceImport = [...workspaceNames].some(name => helpers.sameOrUnder(reference.specifier, name));
    const internal = reference.specifier.startsWith('.') || helpers.pathAliasMatches(reference.specifier, project.options.paths) || workspaceImport;
    // A __generated__/ folder is the gitignored output of the app's codegen step (the GraphQL wire types, fe-stack codegen): it
    // exists after `npm run codegen`, which lint, typecheck and build run first, and the compiler proves those imports there.
    const generated = /(?:^|\/)__generated__(?:\/|$)/.test(reference.specifier);
    if (codeLike && internal && !generated)
        errors.push({
            ruleId: 'ARCH_INTERNAL_IMPORT_UNRESOLVED',
            project: project.relative,
            path: helpers.relativePath(config.root, sourceFile.fileName),
            ...helpers.sourceLocation(sourceFile, reference.node),
            specifier: reference.specifier,
            message: `Internal import ${reference.specifier} is not resolvable with ${project.relative}.`,
        });
}
function internalReference(reference, project, workspaceNames, helpers) {
    const workspaceImport = [...workspaceNames].some(name => reference.specifier === name || reference.specifier.startsWith(`${name}/`));
    return reference.specifier.startsWith('.') || helpers.pathAliasMatches(reference.specifier, project.options.paths) || workspaceImport;
}
function appendBoundaryFinding(state, reference, sourceFile, project, actualTarget, { internal, reviewable }) {
    const { config, errors, helpers } = state;
    if (internal && helpers.crossesSide(config, actualTarget)) {
        errors.push({
            ruleId: 'ARCH_INTERNAL_IMPORT_OUTSIDE',
            project: project.relative,
            path: helpers.relativePath(config.root, sourceFile.fileName),
            ...helpers.sourceLocation(sourceFile, reference.node),
            specifier: reference.specifier,
            message: `Internal import ${reference.specifier} leaves the ${path.basename(config.root)} side for ${helpers.slash(path.relative(config.packageRoot, actualTarget))}; nothing crosses the sides of an app.`,
        });
        return true;
    }
    if (internal && !reviewable) {
        errors.push({
            ruleId: 'ARCH_INTERNAL_IMPORT_OUTSIDE',
            project: project.relative,
            path: helpers.relativePath(config.root, sourceFile.fileName),
            ...helpers.sourceLocation(sourceFile, reference.node),
            specifier: reference.specifier,
            message: `Internal import ${reference.specifier} resolves outside the checked repository.`,
        });
        return true;
    }
    return false;
}
function appendEdge(from, sourceFile, project, owningWorkspace, reference, actualTarget, state) {
    if (!state.fileMap.has(actualTarget))
        return;
    const { config, ts, edges, edgeKeys, errors, helpers, workspaces } = state;
    const edge = {
        from,
        to: actualTarget,
        runtime: reference.runtime,
        specifier: reference.specifier,
        node: reference.node,
        declaration: reference.declaration,
        reexport: ts.isExportDeclaration(reference.declaration),
        sourceFile,
        project: project.relative,
        ...helpers.sourceLocation(sourceFile, reference.node),
    };
    const key = `${from}\0${actualTarget}\0${reference.node.getStart(sourceFile)}\0${reference.specifier}`;
    if (!edgeKeys.has(key)) {
        edges.get(from)?.push(edge);
        edgeKeys.add(key);
    }
    const targetWorkspace = helpers.workspaceOf(workspaces, actualTarget);
    if (owningWorkspace && targetWorkspace && owningWorkspace !== targetWorkspace) {
        if (!owningWorkspace.app && targetWorkspace.app)
            errors.push(helpers.boundaryViolation(config.root, edge, owningWorkspace, targetWorkspace, 'ARCH_PACKAGE_IMPORTS_APP', 'A reusable workspace package cannot depend on an application workspace.'));
        if (!helpers.packageExported(ts, targetWorkspace, reference.specifier, actualTarget))
            errors.push(helpers.boundaryViolation(config.root, edge, owningWorkspace, targetWorkspace, 'ARCH_PACKAGE_EXPORT_BYPASS', 'Cross-package imports must use the target package name and a declared package export.'));
    }
}
function processReference(from, sourceFile, project, owningWorkspace, reference, state) {
    const { config, ts, workspaceNames, workspaces, host, errors, helpers } = state;
    // A workspace package is read at its source, never at its build: the same import resolves whether or not dist exists.
    const workspaceTarget = workspaces.filter(item => item.root !== helpers.canonical(config.root)).map(item => helpers.workspaceSourceEntry(ts, item, reference.specifier)).find(Boolean);
    const resolvedName = workspaceTarget ?? helpers.resolveTypeScriptModule(ts, reference.specifier, sourceFile.fileName, project.options, host, resolutionCache(state, project));
    if (!resolvedName) {
        unresolvedReferenceFinding(reference, sourceFile, project, config, workspaceNames, errors, helpers);
        return;
    }
    const actualTarget = helpers.canonical(resolvedName);
    const internal = internalReference(reference, project, workspaceNames, helpers);
    // The boundary is the checkout, not the checked project: a path alias that lands in a sibling
    // package of the same repository (`@fe-kit/*` -> packages/fe-kit) is still source a reviewer can
    // open, while anything past the repository, or anything inside an installed dependency tree, is
    // not. `config.repository` is null when there is no git checkout around the project, and the
    // project is then the boundary it always was.
    const reviewable = helpers.isInside(config.root, actualTarget)
        || Boolean(config.repository && helpers.isInside(config.repository, actualTarget) && !helpers.slash(actualTarget).includes('/node_modules/'));
    // A side of an app (config.root is be/ or fe/) imports nothing of the app outside itself: the root holds no source, the other
    // side is another program, and a declared read (sides.fe.reads, be/contracts/) is codegen input, never an import.
    if (appendBoundaryFinding(state, reference, sourceFile, project, actualTarget, { internal, reviewable }))
        return;
    appendEdge(from, sourceFile, project, owningWorkspace, reference, actualTarget, state);
}
function processSourceFile(from, sourceFile, state) {
    const { config, ts, workspaces, ownerByFile, helpers } = state;
    const owningWorkspace = helpers.workspaceOf(workspaces, from);
    const project = ownerByFile.get(from);
    if (!project)
        return;
    const references = helpers.moduleReferences(ts, sourceFile, project.program.getTypeChecker());
    addUnprovenFindings(sourceFile, project, references, state.errors, config, helpers);
    for (const reference of references.found)
        processReference(from, sourceFile, project, owningWorkspace, reference, state);
}
function dependencyGraph(config, loaded, fileGraph, ownerByFile, errors, helpers) {
    const { ts } = loaded;
    const edgeKeys = new Set();
    const host = { ...ts.sys, fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, realpath: ts.sys.realpath };
    const workspaces = helpers.workspaceMetadata(config);
    const workspaceNames = new Set(workspaces.map(item => item.name).filter((name) => Boolean(name)));
    const state = { config, ts, fileMap: fileGraph.fileMap, edges: fileGraph.edges, edgeKeys, errors, workspaces, workspaceNames, host, ownerByFile, helpers, resolutionCount: 0 };
    for (const [from, sourceFile] of fileGraph.fileMap)
        processSourceFile(from, sourceFile, state);
    return { edges: fileGraph.edges, workspaces };
}
export function contextFromProjects(config, loaded, paths, helpers) {
    const { ts } = loaded;
    const errors = [];
    const projectState = loadProjectConfigurations(config, ts, helpers, errors);
    const selection = selectProjects(config, paths, ts, projectState, helpers);
    const projects = createProjects(config, paths, projectState, selection, ts, helpers);
    const fileGraph = makeFileGraph(config, projects, helpers);
    const { edges, workspaces } = dependencyGraph(config, loaded, fileGraph, fileGraph.ownerByFile, errors, helpers);
    if (projects.length && fileGraph.files.length === 0)
        errors.push({ ruleId: 'ARCH_NO_SOURCE', message: 'The configured TypeScript projects contain no production TypeScript or JavaScript source.' });
    const { checkerByFile } = fileGraph;
    return { loaded, errors, files: fileGraph.files, edges, programs: projects.map(item => item.program), program: projects[0]?.program ?? null, projects, ts, workspaces,
        // reason: every file the checkers walk belongs to a program; an unknown file still answers null, as before.
        checkerFor: (file) => (checkerByFile.get(helpers.canonical(file)) ?? null),
        workspaceOf: (file) => helpers.workspaceOf(workspaces, helpers.canonical(file)) };
}
