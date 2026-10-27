/** CTA-6 fixtures prove universal intent laws independently of a Grammar family or app edition. */
// proves: FE_BUTTON_INTENT@full
// proves: FE_BUTTON_INTENT@lite
// proves: FE_BUTTON_INTENT_REQUIRED@full
// proves: FE_BUTTON_INTENT_REQUIRED@lite
// proves: FE_BUTTON_NO_VARIANT@full
// proves: FE_BUTTON_NO_VARIANT@lite
// proves: FE_DESTRUCTIVE_CONFIRM_IN_DIALOG@full
// proves: FE_DESTRUCTIVE_CONFIRM_IN_DIALOG@lite
// proves: FE_SINGLE_COMMIT_PER_RENDER@full
// proves: FE_SINGLE_COMMIT_PER_RENDER@lite
// proves: FE_NO_COMMIT_IN_COLLECTION_ITEM@full
// proves: FE_NO_COMMIT_IN_COLLECTION_ITEM@lite
import assert from "node:assert/strict"
import test from "node:test"
import { ESLint, RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rules, recommended } from "./button-intent.ts"
import { recommended as universal, ruleOwners, rules as published, why } from "./index.ts"

const grammar = 'import { Button, IconButton, AlertDialog, ConfirmDialog, CollectionItem, ItemActions, ListItem, ListBox, Table, GridList, DataTable } from "@starci/grammar/core"; '
const tester = () => new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } })
const fixture = (code, messageId, count = 1) => ({ code: grammar + code, errors: Array.from({ length: count }, () => ({ messageId })) })

test("CTA-6 laws are registered universally at error with their finding codes", () => {
  const codes = ["FE_BUTTON_INTENT_REQUIRED", "FE_BUTTON_NO_VARIANT", "FE_DESTRUCTIVE_CONFIRM_IN_DIALOG", "FE_SINGLE_COMMIT_PER_RENDER", "FE_NO_COMMIT_IN_COLLECTION_ITEM"]
  Object.entries(rules).forEach(([name, rule], index) => {
    assert.equal(published[name], rule)
    assert.equal(ruleOwners[name], "button-intent")
    assert.equal(recommended[`starci-fe/${name}`], "error")
    assert.equal(universal[`starci-fe/${name}`], "error")
    assert.equal(why[name].code, codes[index])
  })
})

for (const edition of ["lite", "full"]) {
  for (const family of ["core", "offset-pop"]) {
    test(`CTA-6 ${edition} ${family}: valid intents pass and missing intents are rejected`, () => {
  assert.doesNotThrow(() => {
      tester().run("button-intent-required", rules["button-intent-required"], {
        valid: [
          grammar + 'const Page = () => <Button intent="commit" />',
          grammar + 'const Page = () => <IconButton intent="neutral" aria-label="Edit" />',
          grammar + 'const props={intent:"dismiss"}; const Page = () => <Button {...props} />',
          grammar + 'const Page = () => <Button {...(active ? {intent:"commit"} : {intent:"alternative"})} />',
          grammar + 'const Page = ({intent}) => <Button intent={intent} />',
          'import {Button} from "other-kit"; const Page=()=> <Button />',
          grammar + 'const Page = ({Button}) => <Button />',
          grammar + 'const Page = () => <button />',
        ],
        invalid: [
          fixture('const Page = () => <Button />', "FE_BUTTON_INTENT_REQUIRED"),
          fixture('const Page = () => <IconButton aria-label="Edit" />', "FE_BUTTON_INTENT_REQUIRED"),
          fixture('const Page = () => <Button {...props} />', "FE_BUTTON_INTENT_REQUIRED"),
          fixture('const Page = () => <Button intent />', "FE_BUTTON_INTENT_REQUIRED"),
          fixture('const Page = () => <Button intent={undefined} />', "FE_BUTTON_INTENT_REQUIRED"),
          fixture('const Page = () => <Button intent={null} />', "FE_BUTTON_INTENT_REQUIRED"),
          fixture('const Page = () => <Button {...(active ? {intent:"commit"} : {})} />', "FE_BUTTON_INTENT_REQUIRED"),
          { code: `import {Button as Action} from "@starci/grammar/${family}"; const Page=()=> <Action />`, errors: [{ messageId: "FE_BUTTON_INTENT_REQUIRED" }] },
          { code: `import * as G from "@starci/grammar/${family}"; const Page=()=> <G.IconButton />`, errors: [{ messageId: "FE_BUTTON_INTENT_REQUIRED" }] },
        ],
      })
    
  })
})
  }

  test(`CTA-6 ${edition}: valid app intent passes and app variant is forbidden even with a props spread`, () => {
  assert.doesNotThrow(() => {
    tester().run("button-no-variant", rules["button-no-variant"], {
      valid: [grammar + 'const Page=()=> <Button intent="commit" />', grammar + 'const Page=({Button})=> <Button variant="primary" />', 'import {Button} from "other-kit"; const Page=()=> <Button variant="primary" />'],
      invalid: [
        fixture('const Page=()=> <Button variant="primary" />', "FE_BUTTON_NO_VARIANT"),
        fixture('const Page=()=> <IconButton intent="neutral" variant={variant} />', "FE_BUTTON_NO_VARIANT"),
        fixture('const props={variant:"outline",intent:"neutral"}; const Page=()=> <Button {...props} />', "FE_BUTTON_NO_VARIANT"),
        fixture('const props={inner:{variant:"ghost"}}; const Page=()=> <Button {...props.inner} />', "FE_BUTTON_NO_VARIANT"),
        fixture('const props={variant:"outline"}; const Page=()=> <Button {...{...props}} />', "FE_BUTTON_NO_VARIANT"),
        { code: 'import {Button as Action} from "@starci/grammar/offset-pop"; const Page=()=> <Action variant="primary" />', errors: [{ messageId: "FE_BUTTON_NO_VARIANT" }] },
        { code: 'import * as G from "@starci/grammar/offset-pop"; const Page=()=> <G.Button variant="primary" />', errors: [{ messageId: "FE_BUTTON_NO_VARIANT" }] },
      ],
    })
  
  })
})

  test(`CTA-6 ${edition}: valid same-file dialog confirms pass and outside confirms are rejected`, () => {
  assert.doesNotThrow(() => {
    tester().run("destructive-confirm-in-dialog", rules["destructive-confirm-in-dialog"], {
      valid: [
        grammar + 'const Page=()=> <AlertDialog><Button intent="dismiss" /><Button intent="destructive" step="confirm" /></AlertDialog>',
        grammar + 'const Page=()=> <ConfirmDialog footer={<Button intent="destructive" step="confirm" />} />',
        grammar + 'const Page=()=> <AlertDialog>{({close}) => <Button intent="destructive" step="confirm" onPress={close} />}</AlertDialog>',
        grammar + 'const Page=()=> <Button intent="destructive" step="entry" />',
        grammar + 'const Page=()=> <Button intent="alternative" />',
        'import {AlertDialog as Confirm, Button as Action} from "@starci/grammar/core"; const Page=()=> <Confirm><Action intent="destructive" step="confirm" /></Confirm>',
        'import * as G from "@starci/grammar/core"; const Page=()=> <G.AlertDialog><G.Button intent="destructive" step="confirm" /></G.AlertDialog>',
      ],
      invalid: [
        fixture('const Page=()=> <Button intent="destructive" step="confirm" />', "FE_DESTRUCTIVE_CONFIRM_IN_DIALOG"),
        fixture('const Page=()=> <AlertDialog trigger={<Button intent="destructive" step="confirm" />} />', "FE_DESTRUCTIVE_CONFIRM_IN_DIALOG"),
        fixture('const Final=()=> <Button intent="destructive" step="confirm" />; const Page=()=> <AlertDialog><Final /></AlertDialog>', "FE_DESTRUCTIVE_CONFIRM_IN_DIALOG"),
        fixture('const Page=({AlertDialog})=> <AlertDialog><Button intent="destructive" step="confirm" /></AlertDialog>', "FE_DESTRUCTIVE_CONFIRM_IN_DIALOG"),
        fixture('const intent="destructive"; const step="confirm"; const Page=()=> <Button intent={intent} step={step} />', "FE_DESTRUCTIVE_CONFIRM_IN_DIALOG"),
        fixture('const props={intent:"destructive",step:"confirm"}; const Page=()=> <Button {...props} />', "FE_DESTRUCTIVE_CONFIRM_IN_DIALOG"),
        fixture('const {intent,step}={intent:"destructive",step:"confirm"}; const Page=()=> <Button intent={intent} step={step} />', "FE_DESTRUCTIVE_CONFIRM_IN_DIALOG"),
        fixture('const Page=()=> <><AlertDialog /><Button intent="destructive" step="confirm" /></>', "FE_DESTRUCTIVE_CONFIRM_IN_DIALOG"),
      ],
    })
  
  })
})

  test(`CTA-6 ${edition}: valid exclusive commit paths pass and concurrent commits are rejected`, () => {
  assert.doesNotThrow(() => {
    tester().run("single-commit-per-render", rules["single-commit-per-render"], {
      valid: [
        grammar + 'const Page=()=> <><Button intent="dismiss" /><Button intent="commit" /></>',
        grammar + 'const Page=()=> active ? <Button intent="commit" /> : <IconButton intent="commit" />',
        grammar + 'const Page=()=> <>{active && <Button intent="commit" />}{!active && <Button intent="commit" />}</>',
        grammar + 'const Page=(props)=> <>{props.state === "form" ? <Button intent="commit" /> : null}{props.state === "confirm" ? <Button intent="commit" /> : null}</>',
        grammar + 'const Page=(props)=> <>{props.state === "form" && <Button intent="commit" />}{props.state !== "form" && <Button intent="commit" />}</>',
        grammar + 'function Page(){ if(active) return <Button intent="commit" />; return <Button intent="commit" /> }',
        grammar + 'function Page(){ if(active) { return <Button intent="commit" /> } else { return <Button intent="commit" /> } }',
        grammar + 'const First=()=> <Button intent="commit" />; const Second=()=> <Button intent="commit" />',
        grammar + 'const Page=()=> <Button intent="alternative" />',
        grammar + 'const Page=()=> <><Button intent={active ? "commit" : "alternative"}/><Button intent={active ? "alternative" : "commit"}/></>',
      ],
      invalid: [
        fixture('const Page=()=> <><Button intent="commit" /><IconButton intent="commit" /></>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const Page=()=> <><Button intent="commit" /><SlotView>{() => <Button intent="commit" />}</SlotView></>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const Page=()=> <><SlotView>{() => {return <Button intent="commit" />}}</SlotView><SlotView>{() => {return <Button intent="commit" />}}</SlotView></>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const Page=()=> <><Button intent="commit" />{active ? <Button intent="commit" /> : <Button intent="neutral" />}</>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const Page=()=> <>{active && <Button intent="commit" />}{ready && <Button intent="commit" />}</>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const Page=()=> <>{active ? <Button intent="commit" /> : <Button intent="dismiss" />}{active && <Button intent="commit" />}</>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const intent="commit"; const Page=()=> <><Button intent={intent} /><Button intent="commit" /></>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('const props={intent:"commit"}; const Page=()=> <><Button {...props} /><Button intent="commit" /></>', "FE_SINGLE_COMMIT_PER_RENDER"),
        fixture('function Page(){ return <><Button intent="commit" /><Button intent="commit" /></> }', "FE_SINGLE_COMMIT_PER_RENDER"),
      ],
    })
  
  })
})

  test(`CTA-6 ${edition}: valid item alternatives pass and collection commits are rejected`, () => {
  assert.doesNotThrow(() => {
    tester().run("no-commit-in-collection-item", rules["no-commit-in-collection-item"], {
      valid: [
        grammar + 'const Page=()=> rows.map(row => <Button key={row.id} intent="alternative" />)',
        grammar + 'const Page=()=> <><CollectionItem><Button intent="neutral" /></CollectionItem><Button intent="commit" /></>',
        grammar + 'const Page=()=> <Button intent="commit" />',
        grammar + 'const Page=()=> rows.map(row => <Row onPress={()=>save(row)} />)',
      ],
      invalid: [
        fixture('const Page=()=> rows.map(row => <Button key={row.id} intent="commit" />)', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> rows.map(row => <SlotView>{() => <Button intent="commit" />}</SlotView>)', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <CollectionItem><SlotView>{() => <Button intent="commit" />}</SlotView></CollectionItem>', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> rows["map"](row => <Button key={row.id} intent="commit" />)', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const renderRow=(row)=> <Button key={row.id} intent="commit" />; const Page=()=> rows.map(renderRow)', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> rows.map(row => { if(row.ready) return <Button intent="commit" />; return null })', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <CollectionItem><Button intent="commit" /></CollectionItem>', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <ItemActions><IconButton intent="commit" /></ItemActions>', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <ListItem><Button intent="commit" /></ListItem>', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <DataTable renderCell={(row)=> <Button intent="commit" />} />', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const renderCell=(row)=> <Button intent="commit" />; const Page=()=> <DataTable renderCell={renderCell} />', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <ListBox.Item><Button intent="commit" /></ListBox.Item>', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <Table.Row><Button intent="commit" /></Table.Row>', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> <GridList.Item><Button intent="commit" /></GridList.Item>', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
        fixture('const Page=()=> rows.map(row => <CollectionItem><Button intent="commit" /></CollectionItem>)', "FE_NO_COMMIT_IN_COLLECTION_ITEM"),
      ],
    })
  
  })
})

}

test("CTA-6: typed literal intent, step and spread variants retain the laws", async () => {
  const root = mkdtempSync(join(tmpdir(), "starci-button-intent-"))
  try {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "preserve", strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler" }, include: ["*.tsx"] }))
    const cases = [
      { code: 'const Page=({intent}:{intent:"commit"})=> <><Button intent={intent}/><Button intent="commit"/></>', ids: ["FE_SINGLE_COMMIT_PER_RENDER"] },
      { code: 'const Page=({step}:{step:"confirm"})=> <Button intent="destructive" step={step}/>', ids: ["FE_DESTRUCTIVE_CONFIRM_IN_DIALOG"] },
      { code: 'const Page=(props:{intent:"neutral",variant:"outline"})=> <Button {...props}/>', ids: ["FE_BUTTON_NO_VARIANT"] },
      { code: 'const Page=(props:{intent:"neutral"})=> <Button {...props}/>', ids: [] },
      { code: 'const Page=(props:{intent?:"neutral"})=> <Button {...props}/>', ids: ["FE_BUTTON_INTENT_REQUIRED"] },
    ]
    for (let index = 0; index < cases.length; index++) writeFileSync(join(root, `Page${index}.tsx`), grammar + cases[index].code)
    const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: [{
      files: ["**/*.tsx"], languageOptions: { parser: tsParser, parserOptions: { project: join(root, "tsconfig.json"), tsconfigRootDir: root, ecmaFeatures: { jsx: true } } },
      plugins: { intent: { rules } }, rules: Object.fromEntries(Object.keys(rules).map((name) => [`intent/${name}`, "error"])),
    }] })
    for (let index = 0; index < cases.length; index++) {
      const [result] = await eslint.lintFiles([join(root, `Page${index}.tsx`)])
      assert.deepEqual(result.messages.map((message) => message.messageId), cases[index].ids, cases[index].code)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
