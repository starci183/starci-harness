# Renderer purity (RENDERER-PURITY-1, R384)

A renderer of a root workspace package (every `.tsx` file of its source, `packages/<pkg>/src/**/*.tsx`) holds presentation only: it maps rows to components, chooses what to show and formats. The unit run measures `.ts` only (BE-TEST-13) and the front end has no tests (SHARED-TEST-1), so logic written inside a renderer has no spec and no coverage bar. The logic lives in a measured `.ts` module (a hook or a rules module beside the renderer) that the renderer calls.

| Rule | Finding code | Fix |
|---|---|---|
| `starci-fe/renderer-presentation-only` | `FE_RENDERER_LOGIC` | Move the computation, aggregation, date math, domain comparison or mutation into a measured `.ts` module and call it; run an action through its declared `ActionHandle`. |

Refused in such a file:

- data computation: `-`, `*`, `/`, `%`, `**` between two non-literal values (one side a member access or a call), `+=`/`-=` accumulation of a data value;
- aggregation: `.reduce`/`.reduceRight`, two or more of `.filter`/`.sort`/`.toSorted`/`.flatMap` in one chain, `Math.max/min(...spread)`;
- date math: arithmetic on `Date.now()`, `new Date()` or `.getTime()`, the `Date` setters, the date-fns functions `add*`, `sub*`, `differenceIn*`, `diff*`, `isBefore`, `isAfter`, `isSame*`, `startOf*`, `endOf*`, `set*`;
- a domain rule: `<`, `<=`, `>`, `>=` between two data values; a size or an index against a collection length is display and stays allowed;
- a mutation outside a declared action: a write to a prop, a parameter or an imported value, an in-place array mutator (`push`, `splice`, `sort`, ...) on data, `fetch`, `localStorage`/`sessionStorage` writes, `navigator.sendBeacon`.

Allowed: `.map`, one `.filter` (a display filter), a sort comparator, ternaries and `&&` that pick a view, comparisons and arithmetic with a literal (`rows.length === 0`, `index + 1`, `ratio * 100`), templates, values the renderer builds itself (a local array it fills, `useRef().current`), and `handle.run(...)` of a declared action. A front-end package (`fe/packages/*`) is judged by the front-end canon alone.
