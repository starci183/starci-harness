import { PROJECT_NAME } from "./project-name"

describe("PROJECT_NAME", () => {
    it("names the project the package belongs to", () => {
        expect(PROJECT_NAME).toBe("{{project}}")
    })
})
