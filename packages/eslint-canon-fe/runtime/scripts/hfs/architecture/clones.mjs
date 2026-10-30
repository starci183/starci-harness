import { byCodeUnit } from '../../lib/list.mjs';
import { canonCloneNodes } from './canon-clones.mjs';
export const CLONE_RULE_IDS = ['HFS_DUPLICATE_CODE'];
const MAX_VIOLATIONS = 200;
const DOOR_ROLES = new Set(['controller', 'resolver', 'gateway', 'consumer', 'processor', 'cli']);
const APP_ENTRY = 'main.ts';
const ID = -1;
const LIT = -2;
const entryAt = (entries, index) => entries[index];
const literalKindSet = (SyntaxKind) => new Set([SyntaxKind.StringLiteral, SyntaxKind.NumericLiteral, SyntaxKind.BigIntLiteral, SyntaxKind.RegularExpressionLiteral,
    SyntaxKind.NoSubstitutionTemplateLiteral, SyntaxKind.TemplateHead, SyntaxKind.TemplateMiddle, SyntaxKind.TemplateTail, SyntaxKind.JsxText]);
function lineOfPosition(lineStarts, position) {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (lineStarts[mid] <= position)
            low = mid;
        else
            high = mid - 1;
    }
    return low + 1;
}
/** True for the nodes that carry no token: documentation comments and whitespace-only JSX text. */
function isTriviaNode(SyntaxKind, node) {
    const kind = node.kind;
    if (kind >= SyntaxKind.FirstJSDocNode && kind <= SyntaxKind.LastJSDocNode)
        return true;
    return kind === SyntaxKind.JsxText && Boolean(node.containsOnlyTriviaWhiteSpaces);
}
function normalizedKindOf(SyntaxKind, literalKinds, kind) {
    if (kind === SyntaxKind.Identifier || kind === SyntaxKind.PrivateIdentifier)
        return ID;
    return literalKinds.has(kind) ? LIT : kind;
}
function visitToken(walk, node, inType) {
    const { ts, sourceFile, kinds, lines, types, lineStarts, literalKinds } = walk;
    const { SyntaxKind } = ts;
    if (isTriviaNode(SyntaxKind, node))
        return;
    if (walk.excluded?.has(node)) {
        walk.segment += 1;
        return;
    }
    const kind = node.kind;
    const typeScope = inType || kind === SyntaxKind.InterfaceDeclaration || kind === SyntaxKind.TypeAliasDeclaration;
    kinds.push(normalizedKindOf(SyntaxKind, literalKinds, kind));
    lines.push(lineOfPosition(lineStarts, node.getStart(sourceFile)));
    types.push(typeScope ? 1 : 0);
    walk.segments.push(walk.segment);
    ts.forEachChild(node, (child) => { visitToken(walk, child, typeScope); });
}
/** Leading import and export-from statements repeat legitimately and are not tokenised. */
const isDroppedStatement = (SyntaxKind, statement) => statement.kind === SyntaxKind.ImportDeclaration || statement.kind === SyntaxKind.ImportEqualsDeclaration
    || (statement.kind === SyntaxKind.ExportDeclaration && Boolean(statement.moduleSpecifier));
export function tokenize(ts, sourceFile, { excluded = null } = {}) {
    const { SyntaxKind } = ts;
    const walk = { ts, sourceFile, kinds: [], lines: [], types: [], segments: [], segment: 0, excluded,
        lineStarts: sourceFile.getLineStarts(), literalKinds: literalKindSet(SyntaxKind) };
    for (const statement of sourceFile.statements) {
        if (!isDroppedStatement(SyntaxKind, statement))
            visitToken(walk, statement, false);
    }
    return { kinds: Int32Array.from(walk.kinds), lines: Int32Array.from(walk.lines), types: Uint8Array.from(walk.types), segments: Int32Array.from(walk.segments) };
}
/** The app a file belongs to, by the slot binding of the manifest; null for a file of no app. */
const appOfFile = (resolver, rel) => resolver.classifyPath(rel).bindings?.app ?? null;
/** True for the app entry and the transport doors: their shape is fixed by the convention and their body cannot hold logic. */
function uniformByDesign(resolver, rel) {
    const classified = resolver.classifyPath(rel);
    if (classified.status !== 'owned' || !classified.slot)
        return false;
    const slot = resolver.slot(classified.slot);
    if (!slot)
        return false;
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    if (slot.appKind !== undefined)
        return base === APP_ENTRY && (slot.requires ?? []).includes(APP_ENTRY);
    const role = base.split('.').at(-2);
    return !slot.owner && (slot.composedBy?.length ?? 0) > 0 && role !== undefined && DOOR_ROLES.has(role) && base.endsWith('.ts');
}
function homeText(profile, sameOwner, crossApp) {
    if (crossApp)
        return 'move it to a package (packages/<pkg>, the shared-code slot of the repository) and import it from both apps';
    if (sameOwner)
        return 'extract it once inside the owner and call it from both places';
    if (profile === 'fe')
        return 'extract it once inside the app (apps/<app>/src/modules/<capability>/ when pure, apps/<app>/src/hooks/<domain>/ for a React hook) and import it from both';
    return "move the shared helper to src/modules/platform/primitives/ or into the owning capability's src/modules/domain/<capability>/ and import it from both";
}
const cloneBuckets = (entries, N, T) => {
    const B1 = 1000003;
    const B2 = 92821;
    let maxTokens = 0;
    for (const file of entries)
        maxTokens = Math.max(maxTokens, file.kinds.length);
    const pow1 = new Int32Array(maxTokens + 1);
    const pow2 = new Int32Array(maxTokens + 1);
    pow1[0] = 1;
    pow2[0] = 1;
    for (let i = 1; i <= maxTokens; i += 1) {
        pow1[i] = Math.imul(pow1[i - 1], B1);
        pow2[i] = Math.imul(pow2[i - 1], B2);
    }
    const buckets = new Map();
    const hashing = { pow1, pow2, B1, B2 };
    entries.forEach((file, fileIndex) => addFileWindows(buckets, file, fileIndex, N, T, hashing));
    return buckets;
};
function signedInt32(value) {
    return Math.imul(value, 1);
}
const prefixHashes = (kinds, B1, B2) => {
    const count = kinds.length;
    const pre1 = new Int32Array(count + 1);
    const pre2 = new Int32Array(count + 1);
    for (let i = 0; i < count; i += 1) {
        pre1[i + 1] = Math.imul(pre1[i], B1) + kinds[i] + 3;
        pre2[i + 1] = Math.imul(pre2[i], B2) + kinds[i] + 7;
    }
    return { pre1, pre2 };
};
const windowKey = (pre, pow, start, end) => signedInt32(pre[end] - Math.imul(pre[start], pow[end - start]));
const addToBucket = (buckets, key, item) => {
    const list = buckets.get(key);
    if (list)
        list.push(item);
    else
        buckets.set(key, [item]);
};
const addFileWindows = (buckets, file, fileIndex, N, T, hashing) => {
    const { pow1, pow2, B1, B2 } = hashing;
    const { kinds, lines, segments } = file;
    const count = kinds.length;
    const { pre1, pre2 } = prefixHashes(kinds, B1, B2);
    let end = 0;
    for (let start = 0; start < count; start += 1) {
        if (start > 0 && lines[start] === lines[start - 1] && segments[start] === segments[start - 1])
            continue;
        const limit = lines[start] + N;
        if (end < start)
            end = start;
        while (end < count && lines[end] < limit && segments[end] === segments[start])
            end += 1;
        if (end === start || lines[end - 1] - lines[start] + 1 < N)
            continue;
        const length = end - start;
        if (length < T)
            continue;
        const key = `${windowKey(pre1, pow1, start, end)}:${windowKey(pre2, pow2, start, end)}:${length}`;
        addToBucket(buckets, key, [fileIndex, start, end]);
    }
};
const sameTokens = (entries, a, b) => {
    const ka = entryAt(entries, a[0]).kinds;
    const kb = entryAt(entries, b[0]).kinds;
    for (let i = 0; i < a[2] - a[1]; i += 1)
        if (ka[a[1] + i] !== kb[b[1] + i])
            return false;
    return true;
};
/** The first other occurrence is the partner; overlapping windows of one file are one occurrence, not a copy. */
const partnerOf = (list, item) => list.find((other) => other !== item && (other[0] !== item[0] || other[1] >= item[2] || item[1] >= other[2]));
const orderedPair = (entries, item, partner) => {
    const sameFile = entryAt(entries, item[0]).rel === entryAt(entries, partner[0]).rel;
    const itemFirst = sameFile ? item[1] < partner[1] : entryAt(entries, item[0]).rel < entryAt(entries, partner[0]).rel;
    return itemFirst ? [item, partner] : [partner, item];
};
const addHit = (hits, a, b) => {
    const key = `${a[0]}|${b[0]}|${b[1] - a[1]}`;
    const group = hits.get(key);
    if (group)
        group.push([a[1], a[2]]);
    else
        hits.set(key, [[a[1], a[2]]]);
};
const cloneHits = (entries, buckets) => {
    const hits = new Map();
    for (const list of buckets.values()) {
        if (list.length < 2)
            continue;
        for (const item of list) {
            const partner = partnerOf(list, item);
            if (!partner || !sameTokens(entries, item, partner))
                continue;
            const [a, b] = orderedPair(entries, item, partner);
            addHit(hits, a, b);
        }
    }
    return hits;
};
const blockShape = (file, start, end) => {
    const nonType = new Set();
    const shapes = new Map();
    for (let i = start; i < end; i += 1) {
        const line = file.lines[i];
        if (!file.types[i])
            nonType.add(line);
        shapes.set(line, signedInt32((shapes.get(line) ?? 7) * 31 + file.kinds[i] + 5));
    }
    return { nonType: nonType.size, distinct: new Set(shapes.values()).size };
};
const appendCloneBlock = (blocks, fileA, fileB, start, end, diag, N) => {
    const shape = blockShape(fileA, start, end);
    if (shape.nonType < Math.ceil(N / 2) || shape.distinct < Math.ceil(N / 3))
        return;
    const lineA = fileA.lines[start];
    const endA = fileA.lines[end - 1];
    blocks.push({ a: fileA, b: fileB, line: lineA, endLine: endA, lines: endA - lineA + 1,
        twin: { path: fileB.rel, line: fileB.lines[start + diag], endLine: fileB.lines[end - 1 + diag] } });
};
const cloneBlocks = (entries, hits, N) => {
    const blocks = [];
    for (const [key, group] of hits) {
        const [ai, bi, diagText] = key.split('|');
        const fileA = entryAt(entries, Number(ai));
        const fileB = entryAt(entries, Number(bi));
        const diag = Number(diagText);
        group.sort((x, y) => x[0] - y[0]);
        let [start, end] = group[0];
        for (const [nextStart, nextEnd] of group.slice(1)) {
            if (nextStart <= end && fileA.segments[nextStart] === fileA.segments[start]
                && fileB.segments[nextStart + diag] === fileB.segments[start + diag]) {
                end = Math.max(end, nextEnd);
                continue;
            }
            appendCloneBlock(blocks, fileA, fileB, start, end, diag, N);
            start = nextStart;
            end = nextEnd;
        }
        appendCloneBlock(blocks, fileA, fileB, start, end, diag, N);
    }
    return blocks;
};
const differentApps = (resolver, a, b) => {
    const left = appOfFile(resolver, a);
    const right = appOfFile(resolver, b);
    return left !== null && right !== null && left !== right;
};
const cloneViolations = (blocks, resolver, profile, N, T) => {
    blocks.sort((x, y) => x.a.rel.localeCompare(y.a.rel) || x.line - y.line || x.b.rel.localeCompare(y.b.rel));
    return blocks.slice(0, MAX_VIOLATIONS).map((block) => ({
        ruleId: 'HFS_DUPLICATE_CODE', path: block.a.rel, line: block.line, endLine: block.endLine, twin: block.twin, lines: block.lines,
        message: `${block.a.rel}:${block.line}-${block.endLine} duplicates ${block.twin.path}:${block.twin.line}-${block.twin.endLine} (${block.lines} lines, threshold ${N} lines / ${T} tokens, identifiers and literals ignored); ${homeText(profile, block.a.unit === block.b.unit, differentApps(resolver, block.a.rel, block.b.rel))}.`,
    }));
};
const cloneCoverage = (entries, blocks, N, T) => {
    const owners = new Set();
    let duplicatedLines = 0;
    for (const block of blocks) {
        owners.add(block.a.unit);
        owners.add(block.b.unit);
        duplicatedLines += block.lines;
    }
    return { status: 'checked', minLines: N, minTokens: T, files: entries.length, cloneBlocks: blocks.length, ownersInvolved: owners.size, duplicatedLines,
        ...(blocks.length > MAX_VIOLATIONS ? { truncated: true } : {}) };
};
export function checkClones({ context, graph }) {
    // reason: the rule-params validators require duplicateBlock on every profile that runs this check
    const { lines: N, tokens: T } = graph.resolver.ruleParams()?.duplicateBlock;
    const ts = context.ts ?? context.loaded.ts;
    const entries = [];
    for (const rel of [...graph.files.keys()].sort(byCodeUnit)) {
        if (/\.d\.[cm]?tsx?$/.test(rel) || uniformByDesign(graph.resolver, rel))
            continue;
        const unit = graph.unit(rel);
        if (!unit)
            continue;
        const sourceFile = graph.files.get(rel).sourceFile;
        entries.push({ rel, unit, ...tokenize(ts, sourceFile, { excluded: canonCloneNodes(ts, sourceFile, graph.profile) }) });
    }
    const buckets = cloneBuckets(entries, N, T);
    const blocks = cloneBlocks(entries, cloneHits(entries, buckets), N);
    const profile = graph.profile;
    const violations = cloneViolations(blocks, graph.resolver, profile, N, T);
    return { violations, coverage: cloneCoverage(entries, blocks, N, T) };
}
