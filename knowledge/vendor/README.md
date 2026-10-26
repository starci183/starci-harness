# Vendor

The grammar is built on HeroUI (`@heroui/react` with `@heroui/styles`; the version is pinned in
[stack/pins.yaml](../stack/pins.yaml)). This folder holds what the vendor ships and why, and the house decisions
about keeping it.

| File | Kind | Read by |
|---|---|---|
| [heroui.md](heroui.md) | reasoning: what each component family ships and why its variants and sizes exist | an agent writing or reviewing a Grammar wrapper, or asking what a vendor variant means |
| [parity.yaml](parity.yaml) | data: the two parity modes and, per vendor component, what a grammar must keep vs may change | the parity gate; the [grammar contract](../grammars/contract.yaml) cites its ids |
| [wrappers.yaml](wrappers.yaml) | data: each Grammar file that imports HeroUI, what it wraps and delegates, and each override with its ruling | the parity gate; an author adding an override |

Read [heroui.md](heroui.md) first, then [parity.yaml](parity.yaml); open [wrappers.yaml](wrappers.yaml) only
when a wrapper changes. When to use a component is [ui/components](../ui/README.md); what it is in every
grammar is the [contract](../grammars/contract.md).

## The vendor reference is generated, not kept here

Exact vendor facts (parts, data slots, classes, defaults, closed values, every CSS rule and the paint families it
decides, the ARIA roles per part) are measured from the installed packages, never written by hand and never
committed to knowledge. The contract between the generator and its readers:

- **Input**: the installed `@heroui/react` and `@heroui/styles` at the pinned version, plus `aria-query` for roles.
- **Output**: an untracked cache keyed by version, `vendor/heroui@<version>/` under the build cache of the
  package that runs the parity gate: one file per component (anatomy, variants, parts with their paint
  families), one file per vendor CSS file (each shared sheet once, referenced by the components that load it),
  and one roles file.
- **Freshness**: a cache whose version differs from the pin is rebuilt before any judge reads it; nothing reads a
  stale cache.
- **Completeness**: class discovery resolves `tailwind-variants` slot tables (`buttonVariants` and its siblings),
  so a part whose classes come from a variant table is measured. A part measured with no paint is a generator
  defect, not a pass: zero findings on the most-used component is suspicious (decision D-15).
- **Coverage**: the reference covers every vendor component, wrapped or not, so "may a grammar use X" is answerable.

The parity judge reads the cache, [parity.yaml](parity.yaml), [wrappers.yaml](wrappers.yaml) and each grammar's
DNA `vendor.parity`. Its findings: `role` (a role the vendor ships is hand-rolled), `anatomy` (a part dropped or
added), `undeclared` (a HeroUI import missing from wrappers), and for strict paint `slot`, `style`, `default`
and `stale` (an override with no matching deviation).

## Pin

[wrappers.yaml](wrappers.yaml) is pinned by sha256 in the latest ruling that records its digest
([decisions/rulings.yaml](../decisions/rulings.yaml)); an added or changed override is red until the owner records
a ruling with the new digest. Only the live pin is kept; earlier digests are git history.
