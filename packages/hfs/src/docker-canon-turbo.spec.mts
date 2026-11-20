// proves: HFS_DOCKER_BASE_PIN
// The canon image: the node 22.20 base and a build stage that copies turbo.json before `npm run build:be`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NODE_IMAGE } from '../runtime/scripts/hfs/rules/docker.mjs';

const TEMPLATES = ['be/image/api', 'be/image/cli', 'be/image/worker', 'be/skeleton/apps/api'];

test('the canon node image is 22.20 on alpine', () => {
  assert.equal(NODE_IMAGE, 'node:22.20.0-alpine3.21');
});

for (const template of TEMPLATES) {
  test(`${template}/Dockerfile copies turbo.json in the build stage before build:be`, () => {
    const text = fs.readFileSync(new URL(`../templates/${template}/Dockerfile`, import.meta.url), 'utf8');
    const build = text.slice(text.indexOf(' AS build'), text.indexOf(' AS runtime'));
    const copy = build.indexOf('COPY turbo.json ./');
    assert.ok(copy > 0, 'COPY turbo.json ./ is missing from the build stage');
    assert.ok(copy < build.indexOf('RUN npm run build:be'));
  });
}
