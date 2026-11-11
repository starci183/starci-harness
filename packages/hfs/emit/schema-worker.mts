// The child process of `starci app emit` for one app.
// Prints the schema the app serves on stdout; exit 3 when the app's module graph has no GraphQL server.
// Loads the repository's own typescript, @nestjs/*, graphql and (when installed) class-validator (resolved from the repository, never from hfs).
//
// Two steps: (1) the module graph of the app root is read from source (static-graph.mts) and yields the resolver classes the
// GraphQL server would collect; (2) only those classes are loaded, and Nest's own GraphQLSchemaFactory builds the schema.
// Step 2 loads code through the repository's own TypeScript; a dependency of a resolver that cannot load here (configuration
// read at import time, a native addon, an ES-only package; only requires written in the repository's own source) is replaced by a stand-in and reported on stderr, because the
// schema depends on the resolver and type classes, never on what they call. A stand-in that is a GraphQL type fails the build.
import path from 'node:path';
import type {} from 'reflect-metadata';
import { appModulePath } from './contracts.mjs';
import { appSource, installLoader, stand } from './class-loader.mjs';
import { graphqlInputBounds, withInputBounds } from './graphql-input-bounds.mjs';

// The parent (contracts.mts) always passes the repository root and the app.
const [rootArgument, app] = process.argv.slice(2) as [string, string];
const repoRoot = path.resolve(rootArgument);
const source = appSource(repoRoot);
const { require } = source;

// ---- step 1: the graph, from source ----
let composition;
try {
  composition = source.graph.compose(path.join(repoRoot, appModulePath(app)));
} catch (error) {
  process.stderr.write(`${(error as Error).message}
`);
  process.exit(1);
}
if (composition === null) process.exit(3);

// ---- step 2: the classes, loaded ----
const classOf = installLoader(source, [...composition.resolvers, ...composition.scalars, ...composition.include].map(({ file }) => file)) as (ref: { file: string; name: string }) => any;

// The packages of the repository under emission, resolved from it (never from hfs, which declares none of them).
const FROM_REPOSITORY = { nestGraphql: '@nestjs/graphql', nestCore: '@nestjs/core', graphql: 'graphql', classValidator: 'class-validator' };
const graphql = require(FROM_REPOSITORY.nestGraphql);
// the constants and the scalar factory are internals of the package: reached by file, its `exports` map hides them
const graphqlDist = path.dirname(require.resolve(FROM_REPOSITORY.nestGraphql));
const { SCALAR_NAME_METADATA, SCALAR_TYPE_METADATA } = require(path.join(graphqlDist, 'graphql.constants.js'));
const { createScalarType } = require(path.join(graphqlDist, 'utils', 'scalar-types.utils.js'));

const resolvers = composition.resolvers.map(classOf);
const scalarsMap = composition.scalars.map(classOf).map((cls) => {
  const typeRef = Reflect.getMetadata(SCALAR_TYPE_METADATA, cls);
  return { type: (typeof typeRef === 'function' && typeRef()) || cls, scalar: createScalarType(Reflect.getMetadata(SCALAR_NAME_METADATA, cls), new cls(...Array.from({ length: cls.length }, () => stand))) };
});
const includeModules = composition.include.map(classOf);

const { NestFactory } = require(FROM_REPOSITORY.nestCore);
const { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } = graphql;
const { lexicographicSortSchema, parse, print, printSchema } = require(FROM_REPOSITORY.graphql);
const context = await NestFactory.createApplicationContext(GraphQLSchemaBuilderModule, { logger: false });
const schema = await context.get(GraphQLSchemaFactory).create(resolvers, { scalarsMap, includeModules });
const printed = printSchema(lexicographicSortSchema(schema));
const { TypeMetadataStorage } = require(path.join(graphqlDist, 'schema-builder', 'storages', 'type-metadata.storage.js'));
// A repository without class-validator has no validators, hence no bounds: only that package's absence is tolerated.
let validationStorage = { getTargetValidationMetadatas: () => [] };
try {
  validationStorage = require(FROM_REPOSITORY.classValidator).getMetadataStorage();
} catch (error) {
  if ((error as NodeJS.ErrnoException | undefined)?.code !== 'MODULE_NOT_FOUND' || !String((error as Error).message).includes(`'${FROM_REPOSITORY.classValidator}'`)) throw error;
}
const bounds = graphqlInputBounds({ schema, typeStorage: TypeMetadataStorage, validationStorage });
const document = parse(printed);
const bounded = withInputBounds(document, bounds);
process.stdout.write(bounded === document ? printed : print(bounded));
await context.close();
