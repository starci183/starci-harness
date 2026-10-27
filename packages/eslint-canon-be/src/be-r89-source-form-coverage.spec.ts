// proves: BE_SOURCE_FORM@lite
// proves: BE_SOURCE_FORM@full
// proves: BE_PUBLIC_CONTRACT_FORM@lite
// proves: BE_PUBLIC_CONTRACT_FORM@full
// The lint enforcers of R89; its repository enforcer (`source-suffix` of `starci app check`) is proved in packages/hfs/src/be-r89-source-suffix.spec.mjs.
import test from 'node:test';
import tsParser from '@typescript-eslint/parser';
import { appDeclaration } from '../fixtures/app.mjs';
import { projectFixture } from '../fixtures/project/tester.mjs';
import { at, BE_DECLARATION, TYPED_ROOT } from '../fixtures/typed/tester.mjs';
import { hfsFromDeclaration } from './lib/hfs.ts';
import { noNonAsciiSource, noRestatedNameJsdoc, requireEnumMemberJsdoc, requireExportJsdoc } from './comments.ts';
import { noBareVerbExport, noDefaultExport, noVendorModuleFactoryName, noVersionInName } from './naming.ts';
import { noTestDoubleInSource } from './service-deps.ts';
import { noConstEnum, noInlineObjectType, noInlineParamType } from './type-safety.ts';
import { rules as graphRules } from './project-graph.ts';
import { canonRuleTester, ruleNamed } from "../fixtures/rule-tester.mjs";

const domain = at('src/modules/domain/order/order.service.ts');
const suffixGood = 'src/features/api/orders/application/cancel-order.command.ts';
const suffixBad = 'src/features/api/orders/application/cancel-order.use-case.ts';
const nameGood = 'src/modules/domain/orders/order.service.ts';
const nameBad = 'src/modules/domain/orders/wrong.service.ts';
const contractGood = 'src/modules/domain/orders/read-order.service.ts';
const contractBad = 'src/modules/domain/orders/invalid.service.ts';
const topicPolicy = 'src/modules/domain/orders/order-status.policy.ts';
const topicSuffix = 'src/modules/domain/orders/order-status.topic.ts';
const topicBuilder = [
  'import type { RealtimeTopic } from "../../platform/realtime/realtime.port";',
  'import type { OrderStatusFrame } from "./order.contracts";',
  'const isOrderStatusFrame = (value: unknown): value is OrderStatusFrame => typeof value === "object" && value !== null && "id" in value && typeof value.id === "string";',
  'export const orderStatusTopic = (principalId: string, orderId: string): RealtimeTopic<OrderStatusFrame> => ({ name: `order-status:${principalId}:${orderId}`, accepts: isOrderStatusFrame });',
].join('\n');
const files = {
  [suffixGood]: 'export class CancelOrderCommand {}',
  [suffixBad]: 'export class CancelOrderUseCase {}',
  [nameGood]: 'export class OrderService { read(input: string): string { return input; } }',
  [nameBad]: 'export class Wrong {}',
  [contractGood]: 'import type { Order } from "./order.contracts"; export class ReadOrderService { read(input: Order): Order { return input; } }',
  [contractBad]: 'export class InvalidService { read(input: { readonly id: string }): { readonly id: string } { return input; } }',
  [topicPolicy]: topicBuilder,
  [topicSuffix]: topicBuilder,
  'src/modules/domain/orders/order.contracts.ts': 'export interface Order { readonly id: string } export interface OrderStatusFrame { readonly id: string }',
  'src/modules/platform/realtime/realtime.port.ts': 'export interface RealtimeTopic<T extends object> { readonly name: string; accepts(value: unknown): value is T }',
  'src/modules/platform/realtime/index.ts': 'export type { RealtimeTopic } from "./realtime.port";',
  'src/modules/domain/orders/index.ts': [
    'export { OrderService } from "./order.service";',
    'export { Wrong } from "./wrong.service";',
    'export { ReadOrderService } from "./read-order.service";',
    'export { InvalidService } from "./invalid.service";',
    'export { orderStatusTopic } from "./order-status.policy";',
  ].join('\n'),
};

for (const edition of ['lite', 'full'] as const) {
  test(`R89 ${edition} accepts documented named source and rejects forbidden forms`, () => {
    const hfs = hfsFromDeclaration({ ...appDeclaration('be', BE_DECLARATION), edition }, TYPED_ROOT);
    const tester = canonRuleTester({
      languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
      settings: { starci: { hfs } },
    });
    tester.run('require-export-jsdoc', requireExportJsdoc, {
      valid: ['/** Reads the rows visible to this caller. */\nexport const readRows = () => [];'],
      invalid: [{ code: 'export const readRows = () => [];', errors: [{ messageId: 'jsdoc' }] }],
    });
    tester.run('require-enum-member-jsdoc', requireEnumMemberJsdoc, {
      valid: ['export enum Verdict { /** No grant is made before settlement. */ Pending }'],
      invalid: [{ code: 'export enum Verdict { Pending }', errors: [{ messageId: 'jsdoc' }] }],
    });
    tester.run('no-non-ascii-source', noNonAsciiSource, {
      valid: [{ filename: domain, code: '// The transfer is complete.\nexport const complete = true;' }],
      invalid: [{ filename: domain, code: '// done \u2705\nexport const complete = true;', errors: [{ messageId: 'nonAscii' }] }],
    });
    tester.run('no-restated-name-jsdoc', noRestatedNameJsdoc, {
      valid: ['/** Reads an authorized learner. */\nexport const readUser = () => null;'],
      invalid: [{ code: '/** The read user function. */\nexport const readUser = () => null;', errors: [{ messageId: 'restated' }] }],
    });
    tester.run('no-bare-verb-export', noBareVerbExport, {
      valid: ['export function parseRow() { return null; }'],
      invalid: [{ code: 'export function parse() { return null; }', errors: [{ messageId: 'bareVerb' }] }],
    });
    tester.run('no-vendor-module-factory-name', noVendorModuleFactoryName, {
      valid: ['@Module({}) export class EnvModule { static register() { return {}; } }'],
      invalid: [{ code: '@Module({}) export class EnvModule { static forRoot() { return {}; } }', errors: [{ messageId: 'vendorShaped' }] }],
    });
    tester.run('no-version-in-name', noVersionInName, {
      valid: ['export class SchemaReader {}'],
      invalid: [{ code: 'export class SchemaV3Reader {}', errors: [{ messageId: 'versioned' }] }],
    });
    tester.run('no-const-enum', noConstEnum, {
      valid: ['export enum Verdict { Pass, Fail }'],
      invalid: [{ code: 'export const enum Verdict { Pass, Fail }', errors: [{ messageId: 'constEnum' }] }],
    });
    tester.run('no-inline-object-type', noInlineObjectType, {
      valid: ['interface Input { id: string } export const readInput = (input: Input) => input;'],
      invalid: [{ code: 'export const readInput = (input: { id: string }) => input;', errors: [{ messageId: 'inlineObjectType' }] }],
    });
    tester.run('no-inline-param-type', noInlineParamType, {
      valid: ['interface Input { id: string } export const readInput = ({ id }: Input) => id;'],
      invalid: [{ code: 'export const readInput = ({ id }: { id: string }) => id;', errors: [{ messageId: 'inline' }] }],
    });
    tester.run('no-test-double-in-source', noTestDoubleInSource, {
      valid: [{ filename: domain, code: 'export class OfflineReader {}' }],
      invalid: [{ filename: domain, code: 'export class FakeReader {}', errors: [{ messageId: 'double' }] }],
    });
    tester.run('no-default-export', noDefaultExport, {
      valid: [{ filename: domain, code: 'export class OrderService {}' }],
      invalid: [{ filename: domain, code: 'export default class OrderService {}', errors: [{ messageId: 'default' }] }],
    });
  });

  test(`R89 ${edition} accepts source roles and named public contracts and rejects violations`, (t) => {
    const fixture = projectFixture({ edition, files });
    t.after(fixture.cleanup);
    const tester = fixture.tester;
    tester.run('source-suffix', ruleNamed(graphRules, 'source-suffix'), {
      valid: [{ filename: fixture.at(suffixGood), code: files[suffixGood] }],
      invalid: [{ filename: fixture.at(suffixBad), code: files[suffixBad], errors: [{ messageId: 'finding' }] }],
    });
    tester.run('source-names', ruleNamed(graphRules, 'source-names'), {
      valid: [{ filename: fixture.at(nameGood), code: files[nameGood] }],
      invalid: [{ filename: fixture.at(nameBad), code: files[nameBad], errors: [{ messageId: 'finding' }] }],
    });
    tester.run('public-contract-form', ruleNamed(graphRules, 'public-contract-form'), {
      valid: [{ filename: fixture.at(contractGood), code: files[contractGood] }],
      invalid: [{ filename: fixture.at(contractBad), code: files[contractBad], errors: [{ messageId: 'finding' }, { messageId: 'finding' }] }],
    });
  });

  test(`R89 ${edition} accepts a typed topic policy and rejects an undeclared topic suffix`, (t) => {
    const fixture = projectFixture({ edition, files });
    t.after(fixture.cleanup);
    const policy = { filename: fixture.at(topicPolicy), code: topicBuilder };
    fixture.tester.run('source-suffix', ruleNamed(graphRules, 'source-suffix'), {
      valid: [policy],
      invalid: [{ filename: fixture.at(topicSuffix), code: topicBuilder, errors: [{ messageId: 'finding' }] }],
    });
    fixture.tester.run('source-names', ruleNamed(graphRules, 'source-names'), {
      valid: [policy],
      invalid: [{ filename: fixture.at(nameBad), code: files[nameBad], errors: [{ messageId: 'finding' }] }],
    });
    fixture.tester.run('public-contract-form', ruleNamed(graphRules, 'public-contract-form'), {
      valid: [policy],
      invalid: [{ filename: fixture.at(contractBad), code: files[contractBad], errors: [{ messageId: 'finding' }, { messageId: 'finding' }] }],
    });
  });
}
