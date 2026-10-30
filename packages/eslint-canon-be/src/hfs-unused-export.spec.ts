// proves: HFS_UNUSED_EXPORT@lite
// proves: HFS_UNUSED_EXPORT@full
// proves: HFS_UNUSED_FILE@lite
// proves: HFS_UNUSED_FILE@full
import test from 'node:test';
import { projectFixture } from '../fixtures/project/tester.ts';
import { rules as beRules } from './project-graph.ts';
import { fePlugin } from '../fixtures/sibling-canon.ts';
import type { ProjectFixture } from "../fixtures/project/tester.ts"
import { ruleNamed } from '../fixtures/rule-tester.ts';

/** The text of a fixture file the spec wrote (a spec naming a file it did not write fails here, as the tester would). */
const textAt = (files: Readonly<Record<string, string>>, file: string) => {
  const text = files[file];
  if (text === undefined) throw new Error(`no fixture file ${file}`);
  return text;
};

const sourceCase = (fixture: ProjectFixture, files: Readonly<Record<string, string>>, file: string) => ({ filename: fixture.at(file), code: textAt(files, file) });

for (const edition of ['lite', 'full'] as const) {
  test(`${edition} unit service and logic client specs consume public injection tokens through module aliases`, t => {
    const files = {
      'tsconfig.json': JSON.stringify({ compilerOptions: {
        target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noEmit: true,
        paths: { '@modules/*': ['./src/modules/*'] },
      }, include: ['src/**/*', 'apps/**/*'] }),
      'apps/core/src/app.module.ts': "import { KeycloakClient } from '../../../src/modules/integrations/keycloak'; import { HttpClient } from '../../../src/modules/platform/http'; export const AppModule = [KeycloakClient, HttpClient];",
      'src/modules/integrations/keycloak/index.ts': 'export const KEYCLOAK = Symbol(); export class KeycloakClient {}',
      'src/modules/platform/http/index.ts': 'export const HTTP_CLIENT = Symbol(); export class HttpClient {}',
      'src/modules/domain/identity/session.service.ts': 'export class SessionService {}',
      'src/modules/domain/identity/session.service.spec.ts': "import { KEYCLOAK } from '@modules/integrations/keycloak'; const providers = [{ provide: KEYCLOAK, useValue: {} }];",
      'src/modules/integrations/keycloak/keycloak.client.ts': 'export class KeycloakClient {}',
      'src/modules/integrations/keycloak/keycloak.client.spec.ts': "import { HTTP_CLIENT } from '@modules/platform/http'; const providers = [{ provide: HTTP_CLIENT, useValue: {} }];",
    };
    const fixture = projectFixture({ profile: 'be', edition, files });
    t.after(fixture.cleanup);
    fixture.tester.run('dead-exports', ruleNamed(beRules, 'dead-exports'), {
      valid: [
        sourceCase(fixture, files, 'src/modules/integrations/keycloak/index.ts'),
        sourceCase(fixture, files, 'src/modules/platform/http/index.ts'),
      ],
      invalid: [],
    });
  });

  test(`${edition} back-end dead exports accept consumed exports and reached files and reject unused exports and files`, t => {
    const files = {
      'apps/core/src/app.module.ts': "import { used } from '../../../src/modules/domain/liveness';\nimport { live } from '../../../src/modules/domain/live';\nexport const AppModule = [used, live];\n",
      'apps/core/src/main.ts': "import { boot } from './boot';\nboot();\n",
      'apps/core/src/boot.ts': 'export const boot = () => 1;\n',
      'apps/core/src/stray.ts': 'export const stray = 1;\n',
      'apps/core/src/operations.ts': 'export const OPERATIONS = 1;\n',
      'src/modules/domain/liveness/index.ts': 'export const used = 1;\nexport const unused = 2;\n',
      'src/modules/domain/live/index.ts': 'export const live = 1;\n',
    };
    const fixture = projectFixture({ profile: 'be', edition, files });
    t.after(fixture.cleanup);
    fixture.tester.run('dead-exports', ruleNamed(beRules, 'dead-exports'), {
      valid: [
        sourceCase(fixture, files, 'apps/core/src/main.ts'),
        sourceCase(fixture, files, 'apps/core/src/boot.ts'),
        sourceCase(fixture, files, 'src/modules/domain/live/index.ts'),
      ],
      invalid: [
        { ...sourceCase(fixture, files, 'src/modules/domain/liveness/index.ts'), errors: [{ message: /HFS_UNUSED_EXPORT/u, line: 2 }] },
        { ...sourceCase(fixture, files, 'apps/core/src/stray.ts'), errors: [{ message: /HFS_UNUSED_FILE/u, line: 1 }] },
        // an operations.ts that registers no table through defineOperations is no emitter entry
        { ...sourceCase(fixture, files, 'apps/core/src/operations.ts'), errors: [{ message: /HFS_UNUSED_FILE/u, line: 1 }] },
      ],
    });
  });

  test(`${edition} front-end dead exports accept consumed exports and reached files and reject unused exports and files`, t => {
    const files = {
      'apps/web/src/app/[locale]/page.tsx': "import { used } from '../../modules/liveness';\nimport { live } from '../../modules/live';\nexport default function Route() { return <main>{used + live}</main>; }\n",
      'apps/web/src/modules/liveness/index.ts': 'export const used = 1;\nexport const unused = 2;\n',
      'apps/web/src/modules/liveness/orphan.ts': 'export const orphan = 1;\n',
      'apps/web/src/modules/live/index.ts': 'export const live = 1;\n',
    };
    const fixture = projectFixture({ profile: 'fe', edition, files });
    t.after(fixture.cleanup);
    fixture.tester.run('dead-exports', ruleNamed(fePlugin.rules, 'dead-exports'), {
      valid: [
        sourceCase(fixture, files, 'apps/web/src/app/[locale]/page.tsx'),
        sourceCase(fixture, files, 'apps/web/src/modules/live/index.ts'),
      ],
      invalid: [
        { ...sourceCase(fixture, files, 'apps/web/src/modules/liveness/index.ts'), errors: [{ message: /HFS_UNUSED_EXPORT/u, line: 2 }] },
        { ...sourceCase(fixture, files, 'apps/web/src/modules/liveness/orphan.ts'), errors: [{ message: /HFS_UNUSED_FILE/u, line: 1 }] },
      ],
    });
  });
}

test('lite dead exports count a capability <c>Entities once PRIMARY_ENTITIES names it, and the list once app composition passes it', t => {
  const files = {
    'apps/core/src/app.module.ts': "import { PRIMARY_ENTITIES } from '../../../src/modules/platform/database/entities';\nexport const AppModule = { entities: PRIMARY_ENTITIES };\n",
    'apps/core/src/main.ts': "import { AppModule } from './app.module';\nvoid AppModule;\n",
    'src/modules/platform/database/entities.ts': "import { billingEntities } from '../../domain/billing';\nexport const PRIMARY_ENTITIES = [...billingEntities];\n",
    'src/modules/domain/billing/index.ts': "export { billingEntities } from './persistence/entities/index';\n",
    'src/modules/domain/billing/persistence/entities/index.ts': "import { InvoiceEntity } from './invoice.entity';\nexport const billingEntities = [InvoiceEntity];\n",
    'src/modules/domain/billing/persistence/entities/invoice.entity.ts': 'export class InvoiceEntity { id = "" }\n',
  };
  const fixture = projectFixture({ profile: 'be', edition: 'lite', files });
  t.after(fixture.cleanup);
  fixture.tester.run('dead-exports', ruleNamed(beRules, 'dead-exports'), {
    valid: Object.keys(files).filter(file => file !== 'apps/core/src/main.ts').map(file => sourceCase(fixture, files, file)),
    invalid: [],
  });
});
