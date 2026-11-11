// The child process of `starci app emit` for the REST contract of one app (hfs.json `contract: "rest"`).
// Prints the OpenAPI 3 document the app serves on stdout; exit 1, naming the cause, when it cannot be built.
// Loads the repository's own typescript, @nestjs/core and @nestjs/swagger (resolved from the repository, never from hfs). The app is never
// booted: the controller classes of its module graph are read from source (static-graph.mts `composeHttp`) and loaded alone
// (class-loader.mts), the document head is the `OPENAPI` export of `apps/<app>/src/openapi.ts` (title, version, servers, security schemes:
// what a `DocumentBuilder().build()` answers), and Nest's own `SwaggerModule.createDocument` builds the document over those controllers, so
// the file equals what the running app serves with the same head. A literal `setGlobalPrefix("<prefix>")` of main.ts prefixes every path; a
// prefix that is not one literal, and a graph importing RouterModule, are refused (exit 1) rather than emitted with the wrong paths.
import fs from 'node:fs';
import path from 'node:path';
import type {} from 'reflect-metadata';
import { appModulePath } from './contracts.mjs';
import { appSource, installLoader } from './class-loader.mjs';
import { openapiHeadPath, restDocumentText } from './rest.mjs';

const [rootArgument, app] = process.argv.slice(2) as [string, string];
const repoRoot = path.resolve(rootArgument);
const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
const head = path.join(repoRoot, openapiHeadPath(app));
if (!fs.existsSync(head)) fail(`${openapiHeadPath(app)} is missing: an app whose contract is rest exports OPENAPI there (new DocumentBuilder().setTitle(...).setVersion(...)...build()), the head of its OpenAPI document`);
const source = appSource(repoRoot);
let composition;
try {
  composition = source.graph.composeHttp(path.join(repoRoot, appModulePath(app)));
} catch (error) {
  fail((error as Error).message);
}
if (!composition) fail(`${appModulePath(app)} exports no AppModule class`);
const classOf = installLoader(source, [head, ...composition!.controllers.map(({ file }) => file)]);
const controllers = composition!.controllers.map(classOf) as Array<new (...args: unknown[]) => object>;
const config = (source.require(head) as { OPENAPI?: unknown }).OPENAPI;
if (typeof config !== 'object' || config === null) fail(`${openapiHeadPath(app)} does not export OPENAPI, the document head`);

const { ApplicationConfig } = source.require('@nestjs/core');
const { SwaggerModule } = source.require('@nestjs/swagger');
// The one module the scan reads holds every controller of the graph; a controller is explored on its prototype, never constructed.
const holder = class ContractModule {};
const modules = Object.assign(new Map([['contract', { metatype: holder, imports: new Set(), controllers: new Map(controllers.map((controller) => [controller.name, { metatype: controller, instance: Object.create(controller.prototype) }])) }]]), { applicationId: 'contract' });
// The global prefix main.ts sets is part of every served path: a literal one is applied, anything else cannot be known from source.
const main = path.join(repoRoot, 'apps', app, 'src', 'main.ts');
const mainText = fs.existsSync(main) ? fs.readFileSync(main, 'utf8') : '';
const applicationConfig = new ApplicationConfig();
if (/\bsetGlobalPrefix\s*\(/u.test(mainText)) {
  const literal = /\bsetGlobalPrefix\s*\(\s*(['"])([^'"\n]*)\1\s*\)/u.exec(mainText);
  if (!literal) fail(`apps/${app}/src/main.ts sets a global prefix that is not one string literal (or passes options): the REST emit cannot know the served paths; call setGlobalPrefix("<prefix>") with a literal and no options`);
  applicationConfig.setGlobalPrefix(literal![2]);
}
const application = {
  container: { getModules: () => modules, isGlobalModule: () => false },
  config: applicationConfig,
  getHttpAdapter: () => ({ getType: () => 'express' }),
};
process.stdout.write(restDocumentText(SwaggerModule.createDocument(application, config)));
