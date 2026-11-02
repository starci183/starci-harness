import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
/** The generated input-bounds owner is contract data, not an operation. */
const BOUNDS_MODULE = /(?:^|\/)__generated__\/input-bounds\.ts$/;
/** Directly exported declarations with the requested name; multiple declarations are ambiguous. */
function declaredExports(ts, source, name) {
    let count = 0;
    for (const statement of source.statements) {
        if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
            continue;
        if (ts.isVariableStatement(statement)) {
            count += statement.declarationList.declarations.filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name).length;
        }
        else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name?.text === name)
            count += 1;
    }
    return count;
}
/** The concrete file a relative module specifier resolves to, in the same order as the rule's owner resolver. */
function readSource(ts, target) {
    for (const file of [`${target}.ts`, `${target}/index.ts`, target]) {
        let text;
        try {
            text = readFileSync(file, 'utf8');
        }
        catch {
            continue;
        }
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        if (source.parseDiagnostics.length)
            return null;
        return { file, source };
    }
    return null;
}
/** True only for an unambiguous named export proven through actual declarations to a generated contract declaration. */
export function isBoundsExport(ts, target, name, ownsGenerated, seen = new Set()) {
    const found = readSource(ts, target);
    if (!found)
        return false;
    const { file, source } = found;
    const key = `${file}#${name}`;
    if (seen.has(key) || seen.size >= 32)
        return false;
    const direct = declaredExports(ts, source, name);
    const matches = [];
    let wildcard = false;
    for (const statement of source.statements) {
        if (!ts.isExportDeclaration(statement))
            continue;
        const module = statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
        if (!statement.exportClause) {
            wildcard = true;
            continue;
        }
        if (!ts.isNamedExports(statement.exportClause))
            continue;
        for (const item of statement.exportClause.elements)
            if (item.name.text === name) {
                matches.push({ origin: (item.propertyName ?? item.name).text, module });
            }
    }
    if (wildcard || direct + matches.length !== 1)
        return false;
    if (BOUNDS_MODULE.test(file.replaceAll('\\', '/')))
        return ownsGenerated(file) && direct === 1 && matches.length === 0;
    const match = matches[0];
    if (direct || !match || !match.module?.startsWith('.'))
        return false;
    return isBoundsExport(ts, resolve(dirname(file), match.module), match.origin, ownsGenerated, new Set([...seen, key]));
}
