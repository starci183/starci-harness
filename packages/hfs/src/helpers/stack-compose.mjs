// stack-compose.mjs - the Docker stack seam reads every -c file and enforces the legacy loader's version merge rule.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseYaml } from '../../runtime/engine/yaml.mjs';

/** Parse the stack config inputs and refuse mixed versions, treating absent, empty and 3 as Docker's current 3.x default. */
export function stackConfigModels(args) {
  const models = args.flatMap((arg, index) => arg === '-c' ? [parseYaml(fs.readFileSync(args[index + 1], 'utf8'))] : []);
  assert.ok(models.length > 0, 'docker stack config needs compose inputs');
  const versions = models.map((model) => {
    const version = model.version === undefined ? '' : String(model.version);
    return version === '' || version === '3' ? null : version;
  });
  for (const version of versions) {
    assert.equal(version, versions[0], `version mismatched between two composefiles : ${versions[0]} and ${version}`);
  }
  return models;
}
