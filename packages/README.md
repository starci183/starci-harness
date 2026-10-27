# packages

The packages StarCi apps install from npm: the quality canon and the AI pool router. Each folder is its own npm package: install and test it inside its folder (`npm ci` where it has a lockfile, else `npm install`, then `npm test`). The two ESLint canons' specs share each other's fixtures and rules by relative path (`../eslint-canon-be/fixtures/...`, `../eslint-canon-fe/index.mjs`), so install both before testing either.

- `eslint-canon-fe` (`@starci/eslint-canon-fe`): the universal front-end ESLint canon (`starciFeConfig`, `loadHfs`) for TypeScript and Next.js; consumed by the `fe/eslint.config.mjs` of every StarCi app, beside its Grammar family config.
- `eslint-canon-be` (`@starci/eslint-canon-be`): the back-end ESLint canon (`starciBeConfig`, `loadHfs`) for Nest; consumed by the `be/eslint.config.mjs` of every StarCi app.
- `tsconfig` (`@starci/tsconfig`): the strict TypeScript presets `base`, `be`, `build`, `next` and `e2e`; extended by the tsconfig files of every StarCi app's back end and front end.
- `prettier-config` (`@starci/prettier-config`): the one Prettier config; consumed by every StarCi app's `prettier` setting.
- `stylelint-canon` (`@starci/stylelint-canon`): the CSS canon (Grammar tokens only, brand values only in `brand.css`); consumed by the `stylelint.config.mjs` of StarCi front ends.
- `jest-preset` (`@starci/jest-preset`): the jest config of a Nest repository and the shared unit-test double kit; consumed by the jest config and unit specs of StarCi back ends.
- `ai-router` (`@starci/ai-router`): a zero-dependency pool router for OpenAI-compatible APIs (many keys, models and providers behind `chat`, `stream` and `embeddings`, with breakers, rate-limit awareness, failover and redacted telemetry) and its test double `createFakeProvider`; its `npm test` also typechecks and lints, and fails under 90% line coverage.
