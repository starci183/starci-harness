/** CTA-6 fixtures prove the universal one-primary laws independently of a Grammar family or app edition. */
// proves: FE_BUTTON_INTENT
// proves: FE_BUTTON_INTENT
// proves: FE_SINGLE_COMMIT_PER_RENDER
// proves: FE_SINGLE_COMMIT_PER_RENDER
// proves: FE_NO_COMMIT_IN_COLLECTION_ITEM
// proves: FE_NO_COMMIT_IN_COLLECTION_ITEM
import assert from "node:assert/strict"
import test from "node:test"
import { ESLint, RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rules, recommended } from "./button-intent.ts"
import { recommended as universal, ruleOwners, rules as published, why } from "./index.ts"
import { eslintRule } from "./lib/eslint-boundary.ts"
import { canonTester } from "../fixtures/typed/tester.ts"

/** The canon entry of a rule name, looked up by its published name. */
const whyOf = (name: string) => new Map(Object.entries(why)).get(name)

const grammar = 'import { Button, IconButton, AlertDialog, ConfirmDialog, ListRow, ListBox, Table, GridList, DataTable } from "@starci/grammar/core"; '
const tester = () => canonTester(new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } }))
const fixture = (code: string, messageId: string, count = 1) => ({ code: grammar + code, errors: Array.from({ length: count }, () => ({ messageId })) })

test("CTA-6 laws are registered universally at error with their finding codes", () => {
  const codes = ["FE_SINGLE_COMMIT_PER_RENDER", "FE_NO_COMMIT_IN_COLLECTION_ITEM"]
  Object.entries(rules).forEach(([name, rule], index) => {
    assert.equal(published[name], rule)
    assert.equal(ruleOwners[name], "button-intent")
    assert.equal(recommended[`starci-fe/${name}`], "error")
    assert.equal(universal[`starci-fe/${name}`], "error")
    assert.equal(whyOf(name)?.code, codes[index])
  })
})

for (const edition of ['lite'] as const) {
  for (const family of ["core", "offset-pop"]) {
    test(`CTA-6 ${edition} ${family}: an aliased or namespaced Grammar Button counts its primary`, () => {
      assert.doesNotThrow(() => {
        tester().run("single-commit-per-render", rules["single-commit-per-render"], {
          valid: [`import {Button as Action} from "@starci/grammar/${family}"; const Page=()=> <><Action variant="primary" /><Action /></>`],
          invalid: [
            { code: `import {Button as Action} from "@starci/grammar/${family}"; const Page=()=> <><Action variant="primary" /><Action variant="primary" /></>`, errors: [{ messageId: "FE_SINGLE_COMMIT_PER_RENDER" }] },
            { code: `import * as G from "@starci/grammar/${family}"; const Page=()=> <><G.Button variant="primary" /><G.IconButton variant="primary" /></>`, errors: [{ messageId: "FE_SINGLE_COMMIT_PER_RENDER" }] },
          ],
        })
      })
    })
  }

  test(`CTA-6 ${edition}: valid exclusive primary paths pass and concurrent primaries are rejected`, () => {
  assert.doesNotThrow(() => {
    tester().run("single-commit-per-render", rules["single-commit-per-render"], {
      valid: [
        grammar + 'const Page=()=> <><Button variant="border" /><Button variant="primary" /></>',
        grammar + 'const Page=()=> active ? <Button variant="primary" /> : <IconButton variant="primary" />',
        grammar + 'const Page=()=> <>{active && <Button variant="primary" />}{!active && <Button variant="primary" />}</>',
        grammar + 'const Page=(props)=> <>{props.state === "form" ? <Button variant="primary" /> : null}{props.state === "confirm" ? <Button variant="primary" /> : null}</>',
        grammar + 'const Page=(props)=> <>{props.state === "form" && <Button variant="primary" />}{props.state !== "form" && <Button variant="primary" />}</>',
        grammar + 'function Page(){ if(active) return <Button variant="primary" />; return <Button variant="primary" /> }',
        grammar + 'function Page(){ if(active) { return <Button variant="primary" /> } else { return <Button variant="primary" /> } }',
        grammar + 'const First=()=> <Button variant="primary" />; const Second=()=> <Button variant="primary" />',
        grammar + 'const Page=()=> <Button variant="border" />',
        grammar + 'const Page=()=> <><Button variant={active ? "primary" : "border"}/><Button variant={active ? "border" : "primary"}/></>',
      ],
      invalid: [
        fixture('const Page=()=> <><Button variant="primary" /><IconButton variant="primary" /></>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const Page=()=> <><Button variant="primary" /><SlotView>{() => <Button variant="primary" />}</SlotView></>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const Page=()=> <><SlotView>{() => {return <Button variant="primary" />}}</SlotView><SlotView>{() => {return <Button variant="primary" />}}</SlotView></>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const Page=()=> <><Button variant="primary" />{active ? <Button variant="primary" /> : <Button variant="border" />}</>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const Page=()=> <>{active && <Button variant="primary" />}{ready && <Button variant="primary" />}</>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const Page=()=> <>{active ? <Button variant="primary" /> : <Button variant="border" />}{active && <Button variant="primary" />}</>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const variant="primary"; const Page=()=> <><Button variant={variant} /><Button variant="primary" /></>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const props={variant:"primary"}; const Page=()=> <><Button {...props} /><Button variant="primary" /></>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('function Page(){ return <><Button variant="primary" /><Button variant="primary" /></> }', "FE_SINGLE_COMMIT_PER_RENDER"),
      ],
    })
  
  })
})

  test(`CTA-6 ${edition}: valid item border commands pass and collection primaries are rejected`, () => {
  assert.doesNotThrow(() => {
    tester().run("no-commit-in-collection-item", rules["no-commit-in-collection-item"], {
      valid: [
        grammar + 'const Page=()=> rows.map(row => <Button key={row.id} variant="border" />)',
        grammar + 'const Page=()=> <><ListRow><Button variant="border" /></ListRow><Button variant="primary" /></>',
        grammar + 'const Page=()=> <Button variant="primary" />',
        grammar + 'const Page=()=> rows.map(row => <Row onPress={()=>save(row)} />)',
      ],
      invalid: [
        fixture('const Page=()=> rows.map(row => <Button key={row.id} variant="primary" />)', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> rows.map(row => <SlotView>{() => <Button variant="primary" />}</SlotView>)', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <ListRow><SlotView>{() => <Button variant="primary" />}</SlotView></ListRow>', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> rows["map"](row => <Button key={row.id} variant="primary" />)', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const renderRow=(row)=> <Button key={row.id} variant="primary" />; const Page=()=> rows.map(renderRow)', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> rows.map(row => { if(row.ready) return <Button variant="primary" />; return null })', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <ListRow><Button variant="primary" /></ListRow>', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <DataTable renderCell={(row)=> <Button variant="primary" />} />', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const renderCell=(row)=> <Button variant="primary" />; const Page=()=> <DataTable renderCell={renderCell} />', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <ListBox.Item><Button variant="primary" /></ListBox.Item>', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <Table.Row><Button variant="primary" /></Table.Row>', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <GridList.Item><Button variant="primary" /></GridList.Item>', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> rows.map(row => <ListRow><Button variant="primary" /></ListRow>)', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
      ],
    })
  
  })
})

}

test("CTA-6: typed literal and spread variants retain the laws", async () => {
  const root = mkdtempSync(join(tmpdir(), "starci-button-variant-"))
  try {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "preserve", strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler" }, include: ["*.tsx"] }))
    const cases = [
      { code: 'const Page=({variant}:{variant:"primary"})=> <><Button variant={variant}/><Button variant="primary"/></>', ids: ["FE_SINGLE_COMMIT_PER_RENDER"] },
      { code: 'const Page=(props:{variant:"primary"})=> <><Button {...props}/><Button variant="primary"/></>', ids: ["FE_SINGLE_COMMIT_PER_RENDER"] },
      { code: 'const Page=(props:{variant:"border"})=> <><Button {...props}/><Button variant="primary"/></>', ids: [] },
    ]
    for (const [index, entry] of cases.entries()) writeFileSync(join(root, `Page${index}.tsx`), grammar + entry.code)
    const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: [{
      files: ["**/*.tsx"], languageOptions: { parser: tsParser, parserOptions: { project: join(root, "tsconfig.json"), tsconfigRootDir: root, ecmaFeatures: { jsx: true } } },
      plugins: { intent: { rules: Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, eslintRule(rule)])) } }, rules: Object.fromEntries(Object.keys(rules).map((name) => [`intent/${name}`, "error"])),
    }] })
    for (const [index, entry] of cases.entries()) {
      const [result] = await eslint.lintFiles([join(root, `Page${index}.tsx`)])
      assert.ok(result)
      assert.deepEqual(result.messages.map((message) => message.messageId), entry.ids, entry.code)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
