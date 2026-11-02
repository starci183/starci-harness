/** Actual React hook APIs and SWR public entry points, rather than an arbitrary `use*` spelling. */
const REACT_HOOKS = new Set([
  "use", "useState", "useReducer", "useEffect", "useLayoutEffect", "useInsertionEffect", "useRef", "useImperativeHandle",
  "useMemo", "useCallback", "useContext", "useDebugValue", "useDeferredValue", "useTransition", "useId",
  "useSyncExternalStore", "useActionState", "useOptimistic",
])
const SWR_HOOKS = new Map([
  ["swr", new Set(["useSWR", "useSWRConfig"])],
  ["swr/immutable", new Set(["useSWRImmutable"])],
  ["swr/infinite", new Set(["useSWRInfinite"])],
  ["swr/mutation", new Set(["useSWRMutation"])],
  ["swr/subscription", new Set(["useSWRSubscription"])],
])
const SWR_DEFAULTS = new Map([["swr", "useSWR"], ["swr/immutable", "useSWRImmutable"], ["swr/infinite", "useSWRInfinite"], ["swr/mutation", "useSWRMutation"], ["swr/subscription", "useSWRSubscription"]])
/**
 * The canonical library hooks a composite hook may call (R56, FE-THEME): next-intl, next/navigation,
 * next-themes, react-hook-form and zustand's React entry points. A name outside the list is not a hook by its spelling.
 */
const LIBRARY_HOOKS = new Map([
  ["next-intl", new Set(["useTranslations", "useLocale", "useFormatter", "useNow", "useTimeZone", "useMessages"])],
  ["next/navigation", new Set(["useRouter", "usePathname", "useSearchParams", "useParams", "useSelectedLayoutSegment", "useSelectedLayoutSegments"])],
  ["next-themes", new Set(["useTheme"])],
  ["react-hook-form", new Set(["useForm", "useFormContext", "useWatch", "useController", "useFieldArray", "useFormState"])],
  ["zustand", new Set(["useStore"])],
  ["zustand/react/shallow", new Set(["useShallow"])],
])
/** The marker for an app hook proven by symbol provenance. */
export const OWN_HOOK = "own-hooks"

/** Where a hook comes from: the module and the export it names (null for the module object itself; any key a member reads). */
export interface HookOrigin {
  readonly source: string
  readonly name: unknown
}

/** True when `set` holds `name`. */
const hasName = (set: ReadonlySet<string> | undefined, name: unknown): boolean => set !== undefined && typeof name === "string" && set.has(name)

/** Judge an origin against the canonical library hook catalog. */
export const builtinHook = (origin: HookOrigin | null): boolean => {
  if (origin === null) return false
  return origin.source === OWN_HOOK || hasName(LIBRARY_HOOKS.get(origin.source), origin.name) || origin.source === "react-redux" || (origin.source === "react" ? hasName(REACT_HOOKS, origin.name) : hasName(SWR_HOOKS.get(origin.source), origin.name))
}
/** SWR request hooks are default exports; its root also names useSWRConfig. */
export const namedOrigin = (source: string, name: unknown): HookOrigin | null => {
  if (source === "react") return { source, name }
  if (hasName(LIBRARY_HOOKS.get(source), name)) return { source, name }
  if (name === "default" && SWR_DEFAULTS.has(source)) return { source, name: SWR_DEFAULTS.get(source) }
  return source === "swr" && name === "useSWRConfig" ? { source, name } : null
}

/** A library with a known hook entry. */
export const isLibrarySource = (source: string): boolean => source === "react" || SWR_HOOKS.has(source) || LIBRARY_HOOKS.has(source)
