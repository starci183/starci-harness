// The import graph of a lint side: what counts as an edge, what declares globals, and the dirty set of a change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { changedPaths, declaresGlobals, dependentsOf, dirtySetOf, referencesOf, type ImportGraph, type ImportNode } from '../cache/import-graph.mjs';

const node = (hash: string, imports: string[] = [], globals = false): ImportNode => ({ hash, imports, declaresGlobals: globals });

test('references: static, type-only, dynamic imports, re-exports, require and triple-slash paths are all edges', () => {
  const text = [
    '/// <reference path="./ambient.d.ts" />',
    "import a from './a';", "import type { B } from './b';", "export * from './c';", "export { d } from './d';",
    "const e = await import('./e');", 'const i = await import(`./i`);', "const f = require('./f');", "type G = typeof import('./g');", "import h = require('./h');",
  ].join('\n');
  const found = referencesOf(ts, text);
  assert.deepEqual([...found.specifiers].sort(), ['./a', './b', './c', './d', './e', './f', './g', './h', './i']);
  assert.deepEqual(found.paths, ['./ambient.d.ts']);
});

test('declares globals: a script, `declare global` and a module augmentation do; a plain module does not', () => {
  assert.equal(declaresGlobals(ts, 'a.d.ts', 'declare const X: number;'), true);
  assert.equal(declaresGlobals(ts, 'a.ts', 'var x = 1;'), true);
  assert.equal(declaresGlobals(ts, 'a.ts', 'export {};\ndeclare global { interface Window { x: number } }'), true);
  assert.equal(declaresGlobals(ts, 'a.ts', "import 'x';\ndeclare module 'x' { export const y: number }"), true);
  assert.equal(declaresGlobals(ts, 'a.ts', 'export const a = 1;\nexport declare const b: number;'), false);
  assert.equal(declaresGlobals(ts, 'a.ts', ''), false);
});

test('dependents are transitive and survive a cycle', () => {
  const graph: ImportGraph = new Map([['a', node('1', ['b'])], ['b', node('2', ['c'])], ['c', node('3', ['a'])], ['d', node('4')]]);
  assert.deepEqual([...dependentsOf(graph, ['c'])].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...dependentsOf(graph, ['d'])], []);
});

test('the dirty set holds the changed, their dependents in both graphs and the files whose imports moved', () => {
  const before: ImportGraph = new Map([['a', node('a1', ['b'])], ['b', node('b1')], ['c', node('c1', ['b'])], ['d', node('d1')], ['x', node('x1', ['gone'])], ['gone', node('g1')]]);
  const after: ImportGraph = new Map([['a', node('a2', [])], ['b', node('b2')], ['c', node('c1', ['b'])], ['d', node('d1')], ['x', node('x1', [])]]);
  assert.deepEqual([...changedPaths(before, after)].sort(), ['a', 'b', 'gone']);
  const dirty = dirtySetOf(before, after);
  assert.equal(dirty.wholeSide, null);
  assert.deepEqual([...dirty.dirty].sort(), ['a', 'b', 'c', 'gone', 'x']);
});

test('no recorded graph, or a changed file that declares globals (now or before), dirties the whole side', () => {
  const next: ImportGraph = new Map([['a', node('a1')], ['g.d.ts', node('g2', [], true)]]);
  assert.match(dirtySetOf(null, next).wholeSide ?? '', /no recorded/);
  const previous: ImportGraph = new Map([['a', node('a1')], ['g.d.ts', node('g1', [], true)]]);
  assert.match(dirtySetOf(previous, next).wholeSide ?? '', /g\.d\.ts declares globals/);
  const removed: ImportGraph = new Map([['a', node('a1')]]);
  assert.match(dirtySetOf(previous, removed).wholeSide ?? '', /g\.d\.ts declares globals/);
});
