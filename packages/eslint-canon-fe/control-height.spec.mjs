/** CONTROL-HEIGHT-1 fixtures prove the single 40px control height independently of a Grammar family or app edition. */
// proves: FE_CONTROL_HEIGHT@full
// proves: FE_CONTROL_HEIGHT@lite
import assert from "node:assert/strict"
import test from "node:test"
import { RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { rules, recommended } from "./control-height.mjs"
import { recommended as universal, ruleOwners, rules as published, why } from "./index.mjs"

const grammar = "import { Button, IconButton, Switch, Input, SearchField, Tabs } from \"@starci/grammar/core\"; "
const tester = () => new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } })
const invalid = (code, count = 1, filename) => ({ code: grammar + code, ...(filename ? { filename } : {}), errors: Array.from({ length: count }, () => ({ messageId: "FE_CONTROL_HEIGHT" })) })

test("CONTROL-HEIGHT-1 is registered universally at error with its finding code", () => {
  assert.equal(published["control-height"], rules["control-height"])
  assert.equal(ruleOwners["control-height"], "control-height")
  assert.equal(recommended["starci-fe/control-height"], "error")
  assert.equal(universal["starci-fe/control-height"], "error")
  assert.equal(why["control-height"].code, "FE_CONTROL_HEIGHT")
})

for (const edition of ["lite", "full"]) {
  test(`CONTROL-HEIGHT-1 ${edition}: the default height passes and a larger step or a mixed row is rejected`, () => {
  assert.doesNotThrow(() => {
    tester().run("control-height", rules["control-height"], {
      valid: [
        grammar + "const Bar = () => <div><IconButton intent=\"dismiss\" label=\"a\" /><Switch label=\"t\" size=\"control\" /><SearchField label=\"s\" /></div>",
        grammar + "const Bar = () => <div><Button intent=\"commit\">a</Button><Button intent=\"dismiss\" size=\"md\">b</Button></div>",
        grammar + "const Row = () => <div><IconButton intent=\"dismiss\" label=\"a\" size=\"sm\" /><IconButton intent=\"dismiss\" label=\"b\" size=\"sm\" /></div>",
        grammar + "const Row = ({size}) => <div><IconButton intent=\"dismiss\" label=\"a\" size={size} /><Button intent=\"commit\">b</Button></div>",
        "import { Button } from \"other-kit\"; const Bar = () => <div><Button size=\"lg\" /><Button /></div>",
        grammar + "const Bar = ({Button}) => <Button size=\"lg\" />",
        { code: grammar + "const Cta = () => <Button intent=\"commit\" size=\"lg\">Start</Button>", filename: "src/features/landing/Hero/index.tsx" },
      ],
      invalid: [
        invalid("const Bar = () => <Switch label=\"t\" size=\"lg\" />"),
        invalid("const Bar = () => <Button intent=\"commit\" size=\"lg\">a</Button>"),
        invalid("const Bar = () => <Input label=\"n\" size=\"xl\" />"),
        invalid("const Cta = () => <Button intent=\"commit\" size=\"xl\">Start</Button>", 1, "src/features/landing/Hero/index.tsx"),
        invalid("const Bar = () => <div><IconButton intent=\"dismiss\" label=\"a\" /><IconButton intent=\"dismiss\" label=\"b\" size=\"sm\" /></div>"),
        invalid("const Bar = () => <><Button intent=\"commit\">a</Button><Button intent=\"dismiss\" size=\"sm\">b</Button></>"),
        { code: "import * as G from \"@starci/grammar/offset-pop\"; const Bar = () => <G.Button intent=\"commit\" size=\"lg\">a</G.Button>", errors: [{ messageId: "FE_CONTROL_HEIGHT" }] },
      ],
    })
  
  })
})
}
