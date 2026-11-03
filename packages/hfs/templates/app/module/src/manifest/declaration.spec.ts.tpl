import { {{upper}}_VIEW_IDS, {{upper}}_WORKBENCH } from "./declaration"

describe("the {{pascal}} workbench declaration", () => {
    it("declares one view per id, in strip order", () => {
        expect({{upper}}_WORKBENCH.views.map((view) => view.id)).toEqual([...{{upper}}_VIEW_IDS])
    })

    it("is keyed like its module", () => {
        expect({{upper}}_WORKBENCH).toMatchObject({ key: "{{name}}", namespace: "{{name}}" })
    })
})
