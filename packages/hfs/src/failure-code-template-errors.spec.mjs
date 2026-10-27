import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { templateErrorCodes } from '../runtime/scripts/lib/failure-code-template-errors.mjs';

const t = createRequire(import.meta.url)('typescript');
const ERROR = 'src/modules/platform/receipts/errors/receipts.error.ts';
const SERVICE = 'src/modules/platform/receipts/receipts.service.ts';
const BARREL = 'src/modules/platform/receipts/index.ts';
const FAMILY = `import { DomainError } from '@modules/platform/errors';
export enum ReceiptCode { Used = 'RECEIPT_USED', Invalid = 'RECEIPT_INVALID', Unused = 'RECEIPT_UNUSED' }
export class ReceiptError extends DomainError<ReceiptCode> {}`;
const SERVICE_HEAD = `import { ReceiptError, ReceiptCode } from './errors/receipts.error';\n`;

const emissions = (files) => templateErrorCodes(t, new Map(Object.entries(files).map(([name, text]) => [name, { file: `templates/${name}.tpl`, text }])));
const codes = (files) => emissions(files).map((entry) => entry.code).sort();

test('typed DomainError constructions establish only the enum members they actually emit', () => {
  assert.deepEqual(codes({
    [ERROR]: FAMILY,
    [SERVICE]: `${SERVICE_HEAD}throw new ReceiptError({ code: ReceiptCode.Used });`,
  }), ['RECEIPT_USED']);
  assert.deepEqual(codes({ [ERROR]: FAMILY }), []);
});

test('a public barrel preserves the error family and enum identity through import aliases', () => {
  const found = emissions({
    [ERROR]: FAMILY.replace('{ DomainError }', '{ DomainError as CanonicalError }').replace('extends DomainError', 'extends CanonicalError'),
    [BARREL]: `export { ReceiptError as ErrorFamily, ReceiptCode as Code } from './errors/receipts.error';`,
    [SERVICE]: `import { ErrorFamily as Failure, Code as Refusal } from '@modules/platform/receipts';
throw new Failure({ code: Refusal.Used });`,
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'RECEIPT_USED');
  assert.equal(found[0].file, `templates/${SERVICE}.tpl`);
  assert.equal(found[0].line, 2);
});

test('namespace imports, imported enums and quoted member access retain their actual declarations', () => {
  assert.deepEqual(codes({
    [ERROR]: FAMILY,
    [BARREL]: `export { ReceiptError, ReceiptCode } from './errors/receipts.error';`,
    [SERVICE]: `import * as receipt from './index';
throw new receipt.ReceiptError({ code: receipt.ReceiptCode['Invalid'] });`,
  }), ['RECEIPT_INVALID']);
});

test('comments, code reads, dictionaries and plain Errors cannot keep an unused failure entry current', () => {
  assert.deepEqual(codes({
    [ERROR]: FAMILY,
    [SERVICE]: `${SERVICE_HEAD}
// new ReceiptError({ code: ReceiptCode.Used });
const example = 'RECEIPT_USED';
if (example === ReceiptCode.Used) console.log(example);
throw new Error('RECEIPT_INVALID');
const kinds = { [ReceiptCode.Used]: 'conflict' };`,
  }), []);
});

test('a lookalike base or a different enum cannot establish a genuine typed error emission', () => {
  const templates = {
    [ERROR]: FAMILY,
    [SERVICE]: `${SERVICE_HEAD}enum PretendCode { Used = 'RECEIPT_USED' }
throw new ReceiptError({ code: PretendCode.Used });`,
  };
  assert.deepEqual(codes(templates), []);
  assert.deepEqual(codes({
    ...templates,
    [ERROR]: FAMILY.replace("import { DomainError } from '@modules/platform/errors';", 'class DomainError<T> {}'),
    [SERVICE]: `${SERVICE_HEAD}throw new ReceiptError({ code: ReceiptCode.Used });`,
  }), []);
});

test('a shadowed error, enum or base and a custom constructor cannot manufacture a typed emission', () => {
  for (const binding of [
    'class ReceiptError { constructor(input) {} }',
    "const ReceiptCode = { Used: 'ANOTHER_VALUE' };",
  ]) assert.deepEqual(codes({
    [ERROR]: FAMILY,
    [SERVICE]: `${SERVICE_HEAD}function run() { ${binding}; throw new ReceiptError({ code: ReceiptCode.Used }); }`,
  }), []);
  assert.deepEqual(codes({
    [ERROR]: FAMILY.replace('extends DomainError<ReceiptCode> {}', 'extends DomainError<ReceiptCode> { constructor(input) { super({ code: ReceiptCode.Invalid }); } }'),
    [SERVICE]: `${SERVICE_HEAD}throw new ReceiptError({ code: ReceiptCode.Used });`,
  }), []);
});

test('a later overwritten or unproved code field cannot satisfy the stale-code check', () => {
  for (const args of [
    '{ code: ReceiptCode.Used, code: undefined }',
    '{ code: ReceiptCode.Used, ...other }',
    '{ code: ReceiptCode.Used, [key]: value }',
    '{ code: other }',
  ]) assert.deepEqual(codes({ [ERROR]: FAMILY, [SERVICE]: `${SERVICE_HEAD}throw new ReceiptError(${args});` }), []);
  assert.deepEqual(codes({
    [ERROR]: FAMILY,
    [SERVICE]: `${SERVICE_HEAD}throw new ReceiptError({ ...other, code: ReceiptCode.Invalid });`,
  }), ['RECEIPT_INVALID']);
});

test('undeclared templates and cyclic reexports cannot manufacture an emitter', () => {
  assert.deepEqual(codes({
    [SERVICE]: `${SERVICE_HEAD}throw new ReceiptError({ code: ReceiptCode.Used });`,
  }), []);
  assert.deepEqual(codes({
    [BARREL]: `export { ReceiptError, ReceiptCode } from './cycle';`,
    'src/modules/platform/receipts/cycle.ts': `export { ReceiptError, ReceiptCode } from './index';`,
    [SERVICE]: `import { ReceiptError, ReceiptCode } from './index'; throw new ReceiptError({ code: ReceiptCode.Used });`,
  }), []);
});

test('removing a genuine construction removes the emitter even when its enum and catalog spelling remain', () => {
  const files = { [ERROR]: FAMILY, [SERVICE]: `${SERVICE_HEAD}throw new ReceiptError({ code: ReceiptCode.Used });` };
  assert.deepEqual(codes(files), ['RECEIPT_USED']);
  files[SERVICE] = `${SERVICE_HEAD}export const refusalName = ReceiptCode.Used;`;
  assert.deepEqual(codes(files), []);
});
