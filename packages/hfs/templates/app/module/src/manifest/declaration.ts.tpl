import type { WorkbenchDeclaration } from "@{{project}}/sdk/workbench/contract"

/** The views of the {{pascal}} workbench in strip order (`?tab=`), each labelled from the module's namespace. */
export const {{upper}}_VIEW_IDS: readonly ["overview"] = ["overview"]

/** The {{pascal}} workbench: one overview every member of the workspace opens; grow its views, permissions, operations and exposed reads here. */
export const {{upper}}_WORKBENCH: WorkbenchDeclaration = {
    key: "{{name}}",
    namespace: "{{name}}",
    views: [{ id: "overview", labelKey: "tab_overview" }],
    permissions: [],
    operations: [],
}
