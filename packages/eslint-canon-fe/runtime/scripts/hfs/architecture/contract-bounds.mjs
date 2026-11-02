import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
/** The generated input-bounds module holds constants and a pure reader derived from the contract, never an operation. */
const BOUNDS_MODULE = /(?:^|\/)__generated__\/input-bounds\.ts$/;
const RE_EXPORT = /export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const ENTRY = /^\s*(type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/;
/** True when the named export of `target` is, through a chain of relative named re-exports, defined by a generated input-bounds module. */
export const isBoundsExport = (target, name, depth = 0) => {
    if (depth > 4)
        return false;
    for (const file of [`${target}.ts`, `${target}/index.ts`, target]) {
        let text;
        try {
            text = readFileSync(file, "utf8");
        }
        catch {
            continue;
        }
        if (BOUNDS_MODULE.test(file.replaceAll("\\", "/")))
            return true;
        for (const [, list, source] of text.matchAll(RE_EXPORT)) {
            if (list === undefined || source === undefined || !source.startsWith("."))
                continue;
            for (const entry of list.split(",")) {
                const [, kind, origin, exported] = ENTRY.exec(entry) ?? [];
                if (origin !== undefined && kind === undefined && (exported ?? origin) === name && isBoundsExport(resolve(dirname(file), source), origin, depth + 1))
                    return true;
            }
        }
    }
    return false;
};
