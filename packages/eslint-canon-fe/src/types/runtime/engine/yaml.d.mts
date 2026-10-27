// The types of runtime/engine/yaml.mjs: the document is whatever the YAML says, read with narrowing by its caller.

/** The value a YAML text spells. */
export declare function parseYaml(text: string): unknown
