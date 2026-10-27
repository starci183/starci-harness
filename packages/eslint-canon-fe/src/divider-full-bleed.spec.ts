/** BOUNDARY-1 case-5 regression fixtures for full-bleed horizontal separators. */
// proves: FE_DIVIDER_FULL_BLEED@lite
// proves: FE_DIVIDER_FULL_BLEED@full
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ESLint, RuleTester } from "eslint"
import parser from "@typescript-eslint/parser"
import { dividerFullBleed, recommended, rules } from "./surface-rules.ts"

import { SLOT_FREE_RULES } from "./lib/config.ts"
import { why } from "./lib/why.ts"

const grammar = 'import { Divider, Separator } from "@starci/grammar/core"; '
const error = { messageId: "padding" }

for (const edition of ["lite", "full"]) test(`BOUNDARY-1 ${edition}: valid bands pass and invalid padded horizontal dividers are rejected`, () => {
  assert.ok(SLOT_FREE_RULES.includes("divider-full-bleed"))
  assert.equal(why["divider-full-bleed"].code, "FE_DIVIDER_FULL_BLEED")
  assert.equal(rules["divider-full-bleed"], dividerFullBleed)
  assert.equal(recommended["starci-fe/divider-full-bleed"], "error")
  new RuleTester({
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  }).run("divider-full-bleed", dividerFullBleed, {
    valid: [
      grammar +
        'const Page=()=> <section><header className="px-4">Header</header><Divider /><ul className="px-4"><li>Row</li></ul></section>',
      grammar +
        'const Page=()=> <div className="p-4"><Divider orientation="vertical" /></div>',
      grammar +
        'const vertical="vertical"; const Page=()=> <div className="px-4"><Separator orientation={vertical} /></div>',
      grammar + 'const Page=()=> <div className="py-4"><Divider /></div>',
      'import {Divider} from "other-kit"; const Page=()=> <div className="px-4"><Divider /></div>',
      grammar +
        'const Page=({Divider})=> <div className="px-4"><Divider /></div>',
      grammar +
        'const unused=()=> <Divider />; const Page=()=> <div className="px-4">Content</div>',
      grammar +
        'const Loop=()=> <Loop />; const Page=()=> <div className="px-4"><Loop /></div>',
      grammar +
        'const Page=()=> <div className="px-4">{()=> <Divider />}</div>',
    ],
    invalid: [
      // NIVO regression: one column inset surrounds the header, seam and list.
      {
        code:
          grammar +
          'const Page=()=> <section className="flex flex-col px-4"><header>Header</header><Divider /><ul><li>Row</li></ul></section>',
        errors: [error],
      },
      ...[
        "p-4",
        "px-4",
        "ps-4",
        "pe-4",
        "md:px-4",
        "hover:!p-4",
        "pl-4",
        "pr-4",
      ].map((utility) => ({
        code:
          grammar +
          `const Page=()=> <div className="${utility}"><div><Separator orientation="horizontal" /></div></div>`,
        errors: [error],
      })),
      {
        code:
          grammar +
          'const column="px-4"; const alias=column; const Page=()=> <div className={alias}><Divider /></div>',
        errors: [error],
      },
      {
        code:
          grammar +
          'const styles={column:"ps-4",band:"py-2"}; const Page=()=> <div className={styles.column}><Divider /></div>',
        errors: [error],
      },
      {
        code:
          grammar +
          'const Page=()=> <div className={cn("flex", active && "px-4")}><Divider /></div>',
        errors: [error],
      },
      {
        code:
          grammar +
          'const Child=()=> <Divider />; const Middle=()=> <Child />; const Page=()=> <div className="px-4"><Middle /></div>',
        errors: [error],
      },
      {
        code:
          grammar +
          'const seam=<Divider />; const Page=()=> <div className="p-4">{seam}</div>',
        errors: [error],
      },
      {
        code:
          grammar +
          'const seam=()=> <Divider />; const Page=()=> <div className="p-4">{seam()}</div>',
        errors: [error],
      },
      {
        code:
          grammar +
          'const Page=()=> <div className="p-4">{rows.map(()=> <Divider />)}</div>',
        errors: [error],
      },
      {
        code: 'import * as G from "@starci/grammar/offset-pop"; const Page=()=> <div className="px-4"><G.Divider /></div>',
        errors: [error],
      },
      {
        code: 'import { Separator as Seam } from "@starci/grammar"; const Page=()=> <div className="px-4"><Seam /></div>',
        errors: [error],
      },
      {
        code:
          grammar +
          'const Page=()=> <div className="p-4"><Divider /><Divider /></div>',
        errors: [error],
      },
      {
        code:
          grammar +
          'const Page=()=> <div className="p-4"><div className="px-4"><Divider /></div></div>',
        errors: [error, error],
      },
    ],
  })
})

test("typed classNames.ts imports resolve only the selected constant and object property", async () => {
  const root = mkdtempSync(join(tmpdir(), "starci-divider-"))
  try {
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "preserve",
          module: "ESNext",
          moduleResolution: "Bundler",
        },
        include: ["*.ts", "*.tsx"],
      }),
    )
    writeFileSync(
      join(root, "classNames.ts"),
      'export const column="px-4"; export const styles={column:"md:ps-4",band:"py-2"};',
    )
    const cases = [
      ['import {column} from "./classNames";', "column", 1],
      ['import {styles} from "./classNames";', "styles.column", 1],
      ['import * as C from "./classNames";', 'C.styles["column"]', 1],
      [
        'import {styles} from "./classNames"; const {column:alias}=styles;',
        "alias",
        1,
      ],
      ['import {styles} from "./classNames";', "styles.band", 0],
    ]
    for (let i = 0; i < cases.length; i++)
      writeFileSync(
        join(root, `Page${i}.tsx`),
        grammar +
          cases[i][0] +
          ` const Page=()=> <div className={${cases[i][1]}}><Divider /></div>`,
      )
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ["**/*.tsx"],
          languageOptions: {
            parser,
            parserOptions: {
              project: join(root, "tsconfig.json"),
              tsconfigRootDir: root,
            },
          },
          plugins: {
            canon: { rules: { "divider-full-bleed": dividerFullBleed } },
          },
          rules: { "canon/divider-full-bleed": "error" },
        },
      ],
    })
    for (let i = 0; i < cases.length; i++) {
      const [result] = await eslint.lintFiles([join(root, `Page${i}.tsx`)])
      assert.deepEqual(
        result.messages.map((message) => message.messageId),
        Array(cases[i][2]).fill("padding"),
      )
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
