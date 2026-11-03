# @starci/nest-kit

The building blocks of a StarCi back end that no capability owns. Today: the module definition.

Every module of a back end has a `<x>.module-definition.ts` (R295, owner ruling module-definition-everywhere). Written with Nest's `ConfigurableModuleBuilder` it is either an inferred surface (a destructured export the lint on stated export types, R368, refuses) or a typed builder with a `Host` type and re-exports that two modules of the same shape make a clone (R21, `HFS_DUPLICATE_CODE`). This package states the types once, so the definition is one call.

```ts
// platform/clock/clock.module-definition.ts: the representative module of a capability
import { defineCapabilityModule } from "@starci/nest-kit"
import type { ClockOptions } from "./clock.options"

export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<ClockOptions>()

// features/api/hours/hours.module-definition.ts: any other module
import { defineConfigurableModule } from "@starci/nest-kit"
import type { HoursOptions } from "./hours.options"

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = defineConfigurableModule<HoursOptions>()
```

| export | for |
|---|---|
| `defineConfigurableModule<Options>()` | a sub-module, feature, transport or cli group: `register` / `registerAsync`, never global |
| `defineCapabilityModule<Options>(settings?)` | the representative module of a capability: the same plus the `isGlobal` extra (default `false`); `settings.optionsInjectionToken` names the options token |

`starci app codemod module-definition` rewrites an existing app's definitions to these calls and adds the dependency.

## Tests

`npm test` typechecks, lints and runs the `node:test` specs under 100% line coverage.
