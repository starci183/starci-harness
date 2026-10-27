/** Typed translated message values are product data; the surrounding source remains English. */
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { sourceLanguageHits } from '../runtime/scripts/lib/language.mjs';

// Construct the character under test so each fixture exercises a raw Unicode source character rather than an escape.
const translated = String.fromCodePoint(0x111);
const imported = 'import type { MessageBundle } from "@modules/platform/i18n";\n';
const hits = (text, file = 'messages.ts', parser = ts) => sourceLanguageHits(file, text, parser);

test('typed MessageBundle literal vi values may contain translated text in any owner', () => {
  const source = `${imported}export const M: MessageBundle = { vi: { key: "${translated}" }, en: { key: "Message" } };\n`;
  assert.deepEqual(hits(source, 'platform/http/messages/http.messages.ts'), []);
  assert.deepEqual(hits(source, 'domain/orders/messages/orders.messages.ts'), []);
});

test('MessageBundle import aliases, namespace types and satisfies retain the catalog identity', () => {
  for (const source of [
    `import type { MessageBundle as Bundle } from "@modules/platform/i18n";\nconst M: Bundle = { vi: { key: "${translated}" }, en: { key: "Message" } };`,
    `import type * as Catalog from "@modules/platform/i18n";\nconst M: Catalog.MessageBundle = { vi: { key: \`${translated}\` }, en: { key: "Message" } };`,
    `${imported}const M = { "vi": { key: "${translated}" }, en: { key: "Message" } } satisfies MessageBundle;`,
  ]) assert.deepEqual(hits(source), []);
});

test('a vi-shaped object or a lookalike type is ordinary source', () => {
  for (const source of [
    `const M = { vi: { key: "${translated}" }, en: { key: "Message" } };`,
    `interface MessageBundle { vi: object; en: object }\nconst M: MessageBundle = { vi: { key: "${translated}" }, en: { key: "Message" } };`,
    `import type { MessageBundle } from "./other-contract";\nconst M: MessageBundle = { vi: { key: "${translated}" }, en: { key: "Message" } };`,
  ]) assert.equal(hits(source).length, 1);
});

test('a local type or generic parameter cannot borrow the imported catalog identity', () => {
  for (const source of [
    `${imported}function run() { type MessageBundle = { vi: object; en: object }; const M: MessageBundle = { vi: { key: "${translated}" }, en: { key: "Message" } }; }`,
    `${imported}function run<MessageBundle>() { const M: MessageBundle = { vi: { key: "${translated}" }, en: { key: "Message" } }; }`,
    `import type * as Catalog from "@modules/platform/i18n";\nnamespace Scope { namespace Catalog { export type MessageBundle = object; } const M: Catalog.MessageBundle = { vi: { key: "${translated}" }, en: { key: "Message" } }; }`,
  ]) assert.equal(hits(source).length, 1);
});

test('English values, message keys, comments and expressions stay checked, even on a translated value line', () => {
  for (const source of [
    `${imported}const M: MessageBundle = { vi: { key: "${translated}" }, en: { key: "${translated}" } };`,
    `${imported}const M: MessageBundle = { vi: { "${translated}": "${translated}" }, en: { key: "Message" } };`,
    `${imported}const M: MessageBundle = { vi: { key: "${translated}" /* ${translated} */ }, en: { key: "Message" } };`,
    `${imported}/** ${translated} */ const M: MessageBundle = { vi: { key: "${translated}" }, en: { key: "Message" } };`,
    `${imported}const M: MessageBundle = { vi: { key: (() => "${translated}")() }, en: { key: "Message" } };`,
    `${imported}const M: MessageBundle = { vi: { key: { nested: "${translated}" } }, en: { key: "Message" } };`,
  ]) assert.equal(hits(source).length, 1);
});

test('masking translated values preserves the original position of a later source-language finding', () => {
  const source = `${imported}const M: MessageBundle = {\n vi: { key: "${translated}" },\n en: { key: "${translated}" }\n};\n`;
  assert.deepEqual(hits(source), [{ line: 4, column: 14 }]);
});

test('without a parser and in other source kinds all source text remains checked', () => {
  const source = `${imported}const M: MessageBundle = { vi: { key: "${translated}" }, en: { key: "Message" } };`;
  assert.equal(hits(source, 'messages.ts', null).length, 1);
  assert.equal(hits(source, 'messages.mjs').length, 1);
  assert.deepEqual(hits('export const message = "English";'), []);
});
