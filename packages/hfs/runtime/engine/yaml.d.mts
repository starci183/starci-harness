// yaml.d.mts - the types of yaml.mjs, the vendored yaml@2.9.0 bundle with the runtime's parseYaml/stringifyYaml wrapper.
// That file is generated and frozen (esbuild output, see its header), so it stays JavaScript; this declaration is its TypeScript surface.

/** Parses a YAML 1.2 core-schema document (at most 4 MiB, no aliases, unique keys); throws on invalid or unsupported YAML. */
// reason: a parsed YAML document read from disk (parsed-input boundary); callers narrow or index it by its contract shape.
export function parseYaml(source: string): any;

/** Serializes a value as YAML (line width 100, no aliases). */
export const stringifyYaml: (value: unknown) => string;
