// A custom property that names itself (`--accent: var(--accent)`) is invalid at computed-value time and blanks the colour it is meant to carry.
// The theme-tokens codemod renames the private `--starci-core-*` aliases onto HeroUI's names; an alias whose rename names itself is dropped, not
// written, and a rule block it leaves empty goes with the comment that introduced it. The before-text is the brand layer of a reference app as it stood.
import assert from 'node:assert/strict';
import test from 'node:test';
import { transformThemeTokens } from '../codemod/theme-tokens.mjs';

const run = (text: string) => transformThemeTokens({ text, file: 'fe/apps/web/src/modules/brand/brand.css' });

const APP_BEFORE = `:root,
.light {
    --starci-core-accent-text: color-mix(in oklab, var(--accent) 70%, var(--foreground));
}

/* The grammar tokens resolve on the element that wears the mode class, so each mode reads its own set. */
:root,
.light,
.dark {
    --radius: 0.5rem;
    --field-radius: 0.75rem;

    --starci-core-accent: var(--accent);
    --starci-core-accent-foreground: var(--accent-foreground);
    --starci-core-accent-soft: var(--accent-soft);
    --starci-core-focus: var(--focus);
    --starci-core-canvas: var(--background);
    --starci-core-surface: var(--surface);
    --starci-core-surface-secondary: var(--surface-secondary);
    --starci-core-surface-tertiary: var(--surface-tertiary);
    --starci-core-foreground: var(--foreground);
    --starci-core-muted: var(--muted);
    --starci-core-border: var(--border);
    --starci-core-separator: var(--separator);
    --starci-core-success: var(--success);
    --starci-core-success-foreground: var(--success-foreground);
    --starci-core-warning: var(--warning);
    --starci-core-warning-foreground: var(--warning-foreground);
    --starci-core-danger: var(--danger);
    --starci-core-danger-foreground: var(--danger-foreground);
    --starci-core-info: var(--info);
    --starci-core-info-foreground: var(--info-foreground);
}

.dark {
    --accent: oklch(58.58% 0.222 17.59);
}
`;

test('1. the twenty aliases of an app brand layer are dropped, not renamed onto themselves; what the block also holds stays', () => {
  const result = run(APP_BEFORE);
  assert.equal(result.text, `:root,
.light {
    --accent-soft-foreground: color-mix(in oklab, var(--accent) 70%, var(--foreground));
}

/* The grammar tokens resolve on the element that wears the mode class, so each mode reads its own set. */
:root,
.light,
.dark {
    --radius: 0.5rem;
    --field-radius: 0.75rem;
}

.dark {
    --accent: oklch(58.58% 0.222 17.59);
}
`);
  assert.equal(result.changes.filter((change) => change.to === '(dropped: the alias names itself)').length, 20);
  assert.doesNotMatch(result.text, /--([a-z-]+):\s*var\(--\1\)/u, 'no custom property names itself');
  assert.deepEqual(result.findings, []);
});

test('2. a block that held only aliases goes with its selector lines and the comment above it', () => {
  const only = `.brand {
    --x: 1;
}

/* The aliases of the grammar. */
:root,
.dark {
    --starci-core-accent: var(--accent);
    --starci-core-border: var(--border);
}

.after {
    --y: 2;
}
`;
  assert.equal(run(only).text, `.brand {
    --x: 1;
}

.after {
    --y: 2;
}
`);
});

test('3. an alias that points at another token is renamed as before, and a block with no drop is left as it is', () => {
  const text = `:root {
    --starci-core-accent: #141413;
    --starci-core-accent-text: var(--other);
}

.empty {
}
`;
  const result = run(text);
  assert.equal(result.text, `:root {
    --accent: #141413;
    --accent-soft-foreground: var(--other);
}

.empty {
}
`);
});

test('4. the second run changes nothing', () => {
  const once = run(APP_BEFORE).text;
  assert.equal(run(once).text, once);
});
