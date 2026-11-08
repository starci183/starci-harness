// The dev mail sink of the lite starter: the dev compose runs an unmodified upstream Mailpit pinned by digest in
// contexts/stack/pins.yaml, `starci app stack up` starts it and waits for its healthcheck, the api sends to it over a plain channel on
// loopback only, its web UI is a declared origin, and the dev runbook says how to read the mails.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { normalizeLocal } from '../runtime/scripts/hfs/stack-local-config.mjs';

const REPOSITORY = path.resolve(import.meta.dirname, '..', '..', '..');
const STACKS = path.join(import.meta.dirname, '..', 'templates', 'app', 'skeleton-lite', '.starcistacks');
const read = (...parts: string[]): string => fs.readFileSync(path.join(STACKS, ...parts), 'utf8');
const pins = parseYaml(fs.readFileSync(path.join(REPOSITORY, 'contexts', 'stack', 'pins.yaml'), 'utf8')).images;
// The template carries the project and base port placeholders; the parsers see a project name and a base port.
const render = (text: string): string => text.replaceAll('{{project}}', 'demo').replaceAll('{{basePort}}', '3000').replaceAll('{{apiPort}}', '3001');
const compose = parseYaml(render(read('dev', 'infra', 'compose', 'compose.yaml')));
const stacks = parseYaml(render(read('application-stacks.yaml')));
const local = normalizeLocal(stacks.environments.dev.local, { project: 'demo', env: 'dev' });

test('the dev compose runs Mailpit as the mail service, the image the stack pins and nothing built or mounted into it', () => {
  const mail = compose.services.mail;
  assert.equal(mail.image, `axllent/mailpit:${pins.mailpit.version}`);
  assert.match(mail.image, /@sha256:[0-9a-f]{64}$/u);
  assert.equal(mail.build, undefined);
  assert.equal(mail.volumes, undefined);
  assert.deepEqual(mail.healthcheck.test, ['CMD', '/mailpit', 'readyz']);
});

test('both Mailpit ports publish on loopback only, from the ports the local block declares', () => {
  assert.deepEqual(compose.services.mail.ports, ['127.0.0.1:${STACK_PORT_MAIL}:1025', '127.0.0.1:${STACK_PORT_MAILUI}:8025']);
});

test('the local block starts the mail service, waits for it, declares its two ports and shows its web UI as an origin', () => {
  assert.deepEqual(local.problems, []);
  const block = local.config;
  assert.ok(block);
  assert.deepEqual(block.services.map((service) => [service.name, service.wait]), [['db', 'healthy'], ['mail', 'healthy']]);
  assert.equal(block.ports.mail, 1025);
  assert.equal(block.ports.mailui, 8025);
  assert.deepEqual(block.origins.find((origin) => origin.name === 'mail'), { name: 'mail', url: 'http://localhost:${port.mailui}' });
});

test('the api of the dev environment sends to the sink: its port, a plain channel on loopback and the sender', () => {
  const api = stacks.environments.dev.local.processes.find((process: { name: string }) => process.name === 'api');
  assert.equal(api.env.MAIL_HOST, '127.0.0.1');
  assert.equal(api.env.MAIL_PORT, '${port.mail}');
  assert.equal(api.env.MAIL_SECURITY, 'none');
  assert.match(api.env.MAIL_FROM, /@/u);
});

test('a deployed environment never sends over a plain channel', () => {
  const production = parseYaml(render(read('production', 'infra', 'swarm', 'stack.yaml')));
  assert.equal(production.services.api.environment.MAIL_SECURITY, 'starttls');
  assert.equal(production.services.mail, undefined);
});

test('the dev runbook names the sink and where to read the mails', () => {
  const runbook = read('dev', 'README.md');
  assert.match(runbook, /Mailpit/u);
  assert.match(runbook, /\*\*Mail\.\*\*/u);
  assert.match(runbook, /localhost:8025/u);
});
