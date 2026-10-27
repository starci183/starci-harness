// The realtime config mapper carries unit-tested hub-selection logic; execute the template's parser with typed-reader doubles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { parseYaml } from '../runtime/engine/yaml.mjs';

const root = path.resolve(import.meta.dirname, '..');
const topic = parseYaml(fs.readFileSync(path.join(root, 'runtime/knowledge/patterns/be/realtime.yaml'), 'utf8'));
const config = topic.files.find(entry => entry.path === 'src/modules/platform/realtime/realtime-config.mapper.ts');

test('realtime config uses the logic-role mapper name in the knowledge and template', () => {
  assert.ok(config);
  assert.equal(config.spec, 'src/modules/platform/realtime/realtime-config.mapper.spec.ts');
  assert.equal(path.basename(config.template), 'realtime-config.mapper.ts.tpl');
  assert.ok(fs.existsSync(path.join(root, 'templates/be/patterns', config.template)));
});

const parser = () => {
  const source = fs.readFileSync(path.join(root, 'templates/be/patterns', config.template), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require: name => {
      assert.equal(name, './realtime.contracts');
      return { REDIS_DEFAULT_PREFIX: 'test-prefix' };
    },
  });
  return exports.parseRealtimeConfig;
};

const envOf = values => ({
  has: key => Object.hasOwn(values, key),
  optional: key => values[key],
  secret: key => {
    assert.ok(Object.hasOwn(values, key), `required secret ${key}`);
    return values[key];
  },
  int: (key, fallback) => Number(values[key] ?? fallback),
  enum: (key, allowed) => {
    assert.ok(allowed.includes(values[key]));
    return values[key];
  },
});
const plain = value => JSON.parse(JSON.stringify(value));

test('the realtime config template defaults to Redis and requires its secret', () => {
  const parse = parser();
  assert.deepEqual(plain(parse(envOf({ REALTIME_REDIS_URL: 'redis://localhost' }))), {
    hub: 'redis', url: 'redis://localhost', db: 0, prefix: 'test-prefix',
  });
  assert.throws(() => parse(envOf({})), /required secret REALTIME_REDIS_URL/);
});

test('the realtime config template preserves explicit hub selection and connection options', () => {
  const parse = parser();
  assert.deepEqual(plain(parse(envOf({ REALTIME_HUB: 'memory' }))), { hub: 'memory' });
  assert.deepEqual(plain(parse(envOf({ REALTIME_HUB: 'postgres', REALTIME_DB_URL: 'postgres://direct' }))), {
    hub: 'postgres', listenUrl: 'postgres://direct',
  });
  assert.equal(parse(envOf({ REALTIME_HUB: 'postgres' })).listenUrl, undefined);
  assert.deepEqual(plain(parse(envOf({ REALTIME_HUB: 'redis', REALTIME_REDIS_URL: 'redis://localhost', REALTIME_REDIS_DB: '2', REALTIME_REDIS_PREFIX: 'app' }))), {
    hub: 'redis', url: 'redis://localhost', db: 2, prefix: 'app',
  });
  assert.throws(() => parse(envOf({ REALTIME_HUB: 'unknown' })));
});
