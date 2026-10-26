/** Navigation selection and Grammar styling remain owned by the public component API. */
import assert from "node:assert/strict";
import test from "node:test";
import { at, slotTester } from "./fixtures/typed/tester.mjs";
import { rules, recommended } from "./ui-rulings.mjs";
import { rules as published, recommended as universal } from "./index.mjs";
import { rules as buttonRules } from "./button-intent.mjs";

const grammar =
  'import {ListBox, Rail, Sidebar, Button} from "@starci/grammar/core";';
const filename = at("apps/web/src/components/blocks/Messages/index.tsx");
const fixture = (code, messageId) => ({
  filename,
  code: grammar + code,
  errors: [{ messageId }],
});

test("UI rulings are registered universally at error", () => {
  for (const [name, rule] of Object.entries(rules)) {
    assert.equal(published[name], rule);
    assert.equal(recommended[`starci-fe/${name}`], "error");
    assert.equal(universal[`starci-fe/${name}`], "error");
  }
});

test("fill replaces checks in navigation-like single-select lists", () => {
  slotTester().run(
    "selection-fill-no-check",
    rules["selection-fill-no-check"],
    {
      valid: [
        grammar +
          'const C=()=> <nav><ListBox selectionIndicator="none" /></nav>',
        grammar +
          'const C=()=> <Rail><ListBox selectionMode="single" selectionIndicator={"none"} /></Rail>',
        grammar +
          'const C=()=> <nav><ListBox selectionMode="multiple" /></nav>',
        grammar + 'const C=()=> <nav><ListBox selectionMode="none" /></nav>',
        grammar + 'const C=()=> <ListBox selectionMode="single" />',
        grammar + "const C=({ListBox})=> <nav><ListBox /></nav>",
        'import {ListBox} from "other-kit"; const C=()=> <nav><ListBox /></nav>',
        grammar +
          'const C=()=> <nav><ListBox {...props} selectionIndicator="none" /></nav>',
      ],
      invalid: [
        fixture("const C=()=> <nav><ListBox /></nav>", "indicator"),
        fixture(
          'const C=()=> <Rail><ListBox selectionMode="single" /></Rail>',
          "indicator",
        ),
        fixture(
          'const C=()=> <Sidebar><ListBox selectionIndicator="check" /></Sidebar>',
          "indicator",
        ),
        fixture('const C=()=> <div role="list"><ListBox /></div>', "indicator"),
        fixture(
          'const C=()=> <div role="navigation"><ListBox /></div>',
          "indicator",
        ),
        fixture("const C=()=> <ul><li><ListBox /></li></ul>", "indicator"),
        fixture("const C=()=> <ol><li><ListBox /></li></ol>", "indicator"),
        fixture(
          'const C=()=> <nav><ListBox selectionIndicator="none" {...props} /></nav>',
          "indicator",
        ),
        fixture(
          "const C=()=> <nav><ListBox selectionIndicator={indicator} /></nav>",
          "indicator",
        ),
        {
          code: 'import {ListBox as Choices} from "@starci/grammar/heritage"; const C=()=> <nav><Choices /></nav>',
          errors: [{ messageId: "indicator" }],
        },
        {
          code: 'import * as G from "@starci/grammar/offset-pop"; const C=()=> <G.Rail><G.ListBox /></G.Rail>',
          errors: [{ messageId: "indicator" }],
        },
      ],
    },
  );
});

test("application selectors cannot restyle Grammar internals", () => {
  slotTester().run(
    "no-grammar-internal-selector",
    rules["no-grammar-internal-selector"],
    {
      valid: [
        { filename, code: 'const C=()=> <div className="flex min-w-0" />' },
        {
          filename,
          code: 'const classes=cn("[&_.app-row]:flex", active && "gap-4")',
        },
        { filename, code: "const C=()=> <ChatBubble actions={actions} />" },
        { filename, code: 'const note="Grammar owns starci-core-bubble"' },
      ],
      invalid: [
        fixture(
          'const C=()=> <div className="[&_.starci-core-chat-bubble]:bg-transparent" />',
          "internal",
        ),
        fixture(
          'const classes=cn("[&_.starci-core-chat-bubble]:opacity-0")',
          "internal",
        ),
        fixture(
          'const classes=cn(active && "[&_.starci-core-button]:hidden")',
          "internal",
        ),
        fixture(
          'const classes={hover:"[&_.starci-core-chat-actions]:absolute"}',
          "internal",
        ),
        fixture(
          "const classes=`[&_.starci-core-chat-actions]:${tone}`",
          "internal",
        ),
        fixture('const classes="[&_[class^=starci-core-]]:hidden"', "internal"),
        {
          filename: at("apps/web/src/components/blocks/Messages/classNames.ts"),
          code: 'export const root=cn("[&_.starci-core-chat-bubble]:bg-transparent")',
          errors: [{ messageId: "internal" }],
        },
      ],
    },
  );
});

test("CTA-6 repeated commands declare neutral and never commit or a filled variant", () => {
  slotTester().run(
    "no-commit-in-collection-item",
    buttonRules["no-commit-in-collection-item"],
    {
      valid: [
        grammar +
          'const C=()=> rows.map(row=> <Button key={row.id} intent="neutral" />)',
      ],
      invalid: [
        fixture(
          'const C=()=> rows.map(row=> <Button key={row.id} intent="commit" />)',
          "FE_NO_COMMIT_IN_COLLECTION_ITEM",
        ),
      ],
    },
  );
  slotTester().run("button-no-variant", buttonRules["button-no-variant"], {
    valid: [
      grammar +
        'const C=()=> rows.map(row=> <Button key={row.id} intent="neutral" />)',
    ],
    invalid: [
      fixture(
        'const C=()=> rows.map(row=> <Button key={row.id} intent="neutral" variant="primary" />)',
        "FE_BUTTON_NO_VARIANT",
      ),
    ],
  });
});
