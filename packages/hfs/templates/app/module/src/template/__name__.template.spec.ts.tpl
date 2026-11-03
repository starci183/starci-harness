import { moduleListProblems } from "@{{project}}/agent-sdk/module"
import { {{upper}}_SERVER, {{upper}}_TEMPLATE } from "./{{name}}.template"

describe("{{upper}}_SERVER", () => {
    it("is a module list the host may load", () => {
        expect(moduleListProblems([{{upper}}_SERVER])).toEqual([])
    })

    it("serves its template under the key of the module", () => {
        expect({{upper}}_SERVER.key).toBe({{upper}}_TEMPLATE.key)
        expect({{upper}}_TEMPLATE).toMatchObject({ key: "{{name}}", workbench: "{{name}}" })
    })
})
