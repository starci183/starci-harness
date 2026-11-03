# Changelog

## 0.1.0 - 2026-11-03

The module definition of a StarCi back end as one call, lifted from the 47 templates that each wrote the same typed builder, `Host` type and re-exports.

- Added: `defineConfigurableModule<Options>()`, the definition of a sub-module, feature, transport or cli group: `register` and `registerAsync`, never global. It returns `ModuleDefinition<Options>`, so `export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = defineConfigurableModule<XOptions>()` is the whole `<x>.module-definition.ts`, and the lint that asks for stated export types (R368) accepts it because the helper states them.
- Added: `defineCapabilityModule<Options>(settings?)`, the definition of a capability's representative module: the same, with the `isGlobal` extra defaulting to `false` (globality stays the app root's decision) and an optional `optionsInjectionToken`.
- Added: the types `ModuleDefinition`, `CapabilityModuleDefinition`, `CapabilityExtras` and `CapabilitySettings`.
