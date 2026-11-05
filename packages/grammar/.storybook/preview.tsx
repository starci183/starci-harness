/// <reference types="vite/client" />
import type { Decorator, Preview } from '@storybook/react-vite';
import { Button, Chip } from '@heroui/react';
import React, { type CSSProperties, type ReactNode } from 'react';
import '../node_modules/@heroui/styles/dist/heroui.min.css';
import './story-tones.css';
import commonCss from '../src/common/styles.css?inline';
import coreCss from '../src/core/styles.css?inline';
import offsetPopCss from '../src/offset-pop/styles.css?inline';
import { GrammarRoot, type GrammarRootProps } from '../src/common/index.js';
import { CoreGrammarRoot } from '../src/core/index.js';
import { OffsetPopGrammarRoot } from '../src/offset-pop/index.js';

/*
 * Every story renders inside the GrammarRoot of the family picked in the toolbar, with only that
 * family's packaged stylesheet loaded (each family sheet imports Common first, exactly as an app
 * would import `@starci/grammar/<family>/styles.css`). `common` is the bare neutral root with Common
 * anatomy only. Overlays portal into this root, so they inherit the family scope too.
 */

type Family = 'common' | 'core' | 'offset-pop';
type Theme = NonNullable<GrammarRootProps['theme']>;

const FAMILIES: Record<Family, { readonly css: string; readonly Root: (props: GrammarRootProps) => ReactNode }> = {
  common: { css: commonCss, Root: GrammarRoot },
  core: { css: coreCss, Root: CoreGrammarRoot },
  'offset-pop': { css: offsetPopCss, Root: OffsetPopGrammarRoot },
};

const isFamily = (value: unknown): value is Family => typeof value === 'string' && value in FAMILIES;
const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark' || value === 'system';

/** Story-level knobs read by the decorator: `parameters.grammar`. */
type GrammarParameters = {
  /** Page-level stories draw edge to edge; everything else gets a page inset. */
  readonly bleed?: boolean;
  /** Extra inline style on the root (e.g. a consumer accent override). */
  readonly rootStyle?: CSSProperties;
  /** Minimum root height for overlay stories whose surface is portalled and positioned. */
  readonly minHeight?: string;
};

/**
 * The vendor components the DNA gate compares a wrapper with (`value: { vendor: { component, props, metric } }` in
 * contexts/grammars/contract.yaml): HeroUI's own Button and soft Chip at every step, rendered inside the root so they resolve the
 * same tokens, hidden and inert. `starci dna check` finds them by `data-dna-vendor` and `data-dna-props` and never measures them.
 */
const VENDOR_STEPS = ['sm', 'md', 'lg'] as const;
const VendorReferences = () => (
  <div data-dna-reference="vendor" aria-hidden="true" inert style={{ position: 'absolute', left: 0, top: 0, visibility: 'hidden', pointerEvents: 'none' }}>
    {VENDOR_STEPS.map((size) => (
      <Button key={`button-${size}`} size={size} data-dna-vendor="Button" data-dna-props={JSON.stringify({ size })}>
        Reference
      </Button>
    ))}
    {VENDOR_STEPS.map((size) => (
      <Chip key={`chip-${size}`} variant="soft" size={size} data-dna-vendor="Chip" data-dna-props={JSON.stringify({ variant: 'soft', size })}>
        Reference
      </Chip>
    ))}
  </div>
);

const withGrammarRoot: Decorator = (Story, context) => {
  const family = isFamily(context.globals.grammarFamily) ? context.globals.grammarFamily : 'core';
  const theme = isTheme(context.globals.grammarTheme) ? context.globals.grammarTheme : 'light';
  const grammar = (context.parameters.grammar ?? {}) as GrammarParameters;
  const { css, Root } = FAMILIES[family];
  // The mode is the app's: `.dark` on `html`, as HeroUI reads it.
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const isDocs = context.viewMode === 'docs';
  return (
    <>
      <style data-grammar-storybook-family={family}>{css}</style>
      <Root
        theme={theme}
        data-grammar-storybook-root="true"
        style={{
          minHeight: isDocs ? grammar.minHeight : grammar.minHeight ?? '100vh',
          padding: grammar.bleed === true ? 0 : 'var(--grammar-page-inset, 1.5rem)',
          background: 'var(--background, Canvas)',
          color: 'var(--foreground, CanvasText)',
          ...grammar.rootStyle,
        }}
      >
        {isDocs ? null : <VendorReferences />}
        {/* Catalog stories sit in a main landmark like app content; page stories bring their own. */}
        {grammar.bleed === true ? <Story /> : <main aria-label="Story canvas"><Story /></main>}
      </Root>
    </>
  );
};

const preview: Preview = {
  decorators: [withGrammarRoot],
  globalTypes: {
    grammarFamily: {
      description: 'Grammar family (GrammarRoot + packaged stylesheet)',
      toolbar: {
        title: 'Family',
        icon: 'paintbrush',
        items: [
          { value: 'common', title: 'Common (neutral)' },
          { value: 'core', title: 'Core' },
          { value: 'offset-pop', title: 'Offset Pop' },
        ],
        dynamicTitle: true,
      },
    },
    grammarTheme: {
      description: 'GrammarRoot theme scope',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
          { value: 'system', title: 'System', icon: 'browser' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    // Families/themes can be switched at launch through these env overrides.
    grammarFamily: import.meta.env.VITE_GRAMMAR_FAMILY ?? 'core',
    grammarTheme: import.meta.env.VITE_GRAMMAR_THEME ?? 'light',
  },
  parameters: {
    layout: 'fullscreen',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // `todo` reports violations in the addon panel without failing.
      test: import.meta.env.VITE_A11Y_TEST === 'error' ? 'error' : 'todo',
    },
  },
};

export default preview;
