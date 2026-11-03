import type { ModuleServer, ModuleTemplate } from "@{{project}}/agent-sdk/module"

/** The {{pascal}} module's template: its copy, agent, setup gates, authority actions and accepted commands. */
export const {{upper}}_TEMPLATE: ModuleTemplate = {
    key: "{{name}}",
    order: 100,
    name: { vi: "{{pascal}}", en: "{{pascal}}" },
    shortName: { vi: "{{pascal}}", en: "{{pascal}}" },
    description: { vi: "{{pascal}}", en: "{{pascal}}" },
    points: { vi: [], en: [] },
    purpose: "{{pascal}}",
    icon: "module",
    glyph: "M12 3l9 5v8l-9 5-9-5V8z",
    mascot: "",
    category: "operations",
    status: "early",
    audience: "customer",
    includedWithWorkspace: false,
    available: false,
    knowledgeFolder: "{{name}}",
    workbench: "{{name}}",
    settingsExtras: null,
    requires: { capabilities: [], connections: [] },
    connectionProviders: [],
    defaultOperatingMode: "assist",
    multiInstance: false,
    agent: {
        label: { vi: "{{pascal}}", en: "{{pascal}}" },
        handle: "{{name}}",
        summary: { vi: "{{pascal}}", en: "{{pascal}}" },
        capabilities: { vi: [], en: [] },
        role: { vi: "{{pascal}}", en: "{{pascal}}" },
        instructions: { vi: "{{pascal}}", en: "{{pascal}}" },
    },
    gates: [],
    authorityActions: [],
    accepts: [],
}

/** The server half of the {{pascal}} module: its template and the words it adds to a graph. */
export const {{upper}}_SERVER: ModuleServer = { key: "{{name}}", template: {{upper}}_TEMPLATE }
