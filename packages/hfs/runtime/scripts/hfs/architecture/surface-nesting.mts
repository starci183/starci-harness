import { RenderGraph } from './render-graph.mjs';
import type { Ancestor, RenderElement, RenderVisitor } from './render-graph.mjs';
import type { Violation } from './ast-walks.mjs';
import type { CheckInput } from './hfs-graph.mjs';

/**
 * R356 `surface-nesting` (FE_SURFACE_NESTING), the whole-program half of the one-file card laws (R340, R351, R354, R348, R366).
 * ESLint judges one file; an app draws a screen across several, so the check walks the render graph (render-graph.mts) from every
 * app component and reports, at the inner element, what stands wrongly inside what once every component is replaced by what it
 * draws and every `children` by what its caller handed it:
 *
 *   card-in-card         a card inside a card (a card never stands in a card; a white Pane surface, Drawer, Dialog or Popover HOSTS cards, drawn bordered with no shadow, 0.37.5);
 *   table-in-card        a `DataTable` inside a card (a table stands on the page);
 *   grid-outside-panes   a `PaneGrid` inside a card or a Page whose chrome is not `panes`;
 *   heading-over-card    a `Heading`, or a region `Section`, whose only neighbour or child is one card (a card carries its own label);
 *   label-in-grid        a labelled card repeated by a `.map` in a `Grid kind="cards"` (a repeated tile has no label).
 *
 * A finding carries `crossFile: true` when the two elements are drawn in different files, which is what one-file lint cannot see.
 */
export const SURFACE_NESTING_RULE_IDS = ['FE_SURFACE_NESTING'];

const RULE = 'FE_SURFACE_NESTING';

/** The grammar vocabulary this check reads, in one place so a rename in the grammar is one edit here. */
export const SURFACE_VOCABULARY = Object.freeze({
  cards: new Set(['SurfaceCard']),
  overlays: new Set(['Dialog', 'Drawer', 'AlertDialog', 'Popover']),
  tables: new Set(['DataTable']),
  headings: new Set(['Heading']),
  sections: new Set(['Section']),
  paneGrids: new Set(['PaneGrid']),
  pane: 'Pane',
  page: 'Page',
  grids: new Set(['Grid']),
});

const grammarName = (element: RenderElement): string | null => (element.tag.kind === 'grammar' ? element.tag.name : null);
const isGrammarIn = (element: RenderElement, names: ReadonlySet<string>): boolean => {
  const name = grammarName(element);
  return name !== null && names.has(name);
};

/** The card an element is, or draws at its root through one app component: the one wrapper level the audit allows. */
const cardOf = (graph: RenderGraph, element: RenderElement): RenderElement | null => {
  if (isGrammarIn(element, SURFACE_VOCABULARY.cards)) return element;
  const root = element.tag.kind === 'component' ? graph.rootOf(element) : null;
  return root && isGrammarIn(root, SURFACE_VOCABULARY.cards) ? root : null;
};

const describe = (element: RenderElement): string => (element.tag.kind === 'component' ? `${element.tag.name} (${element.tag.file})` : element.tag.name);
const chainOf = (ancestors: readonly Ancestor[], stack: readonly string[]): string => `${ancestors.map(entry => entry.element.tag.name).join(' > ')}${stack.length > 1 ? ` via ${stack.map(entry => entry.split('#')[1]).join(' > ')}` : ''}`;

export interface SurfaceNestingResult {
  violations: Violation[];
  coverage: { status: 'checked'; components: number };
}

export function checkSurfaceNesting(input: Pick<CheckInput, 'graph'> & { context: { ts: ConstructorParameters<typeof RenderGraph>[0] } }): SurfaceNestingResult {
  const graph = new RenderGraph(input.context.ts, input.graph);
  const found = new Map<string, Violation>();
  const report = (element: RenderElement, outer: RenderElement | null, kind: string, message: string, ancestors: readonly Ancestor[], stack: readonly string[]): void => {
    const where = graph.locate(element);
    const key = `${where.path}:${where.line}:${where.column}:${kind}`;
    if (found.has(key)) return;
    found.set(key, {
      ruleId: RULE, ...where, kind, crossFile: outer !== null && outer.file !== element.file,
      message: `${message} (${chainOf(ancestors, stack)}). A card carries its own label and stands on the page or on a canvas pane; a table stands on the page; a grid stands in Page chrome="panes" (contexts/ui/components/card.md).`,
    });
  };

  const visitor: RenderVisitor = {
    enter(element, ancestors, stack) {
      const name = grammarName(element);
      const nearestCard = [...ancestors].reverse().find(entry => isGrammarIn(entry.element, SURFACE_VOCABULARY.cards));
      if (name !== null && SURFACE_VOCABULARY.cards.has(name)) {
        if (nearestCard) report(element, nearestCard.element, 'card-in-card', `${name} is drawn inside ${describe(nearestCard.element)}: surface in surface is banned`, ancestors, stack);
      }
      if (name !== null && SURFACE_VOCABULARY.tables.has(name) && nearestCard) {
        report(element, nearestCard.element, 'table-in-card', `${name} is drawn inside ${describe(nearestCard.element)}`, ancestors, stack);
      }
      if (name !== null && SURFACE_VOCABULARY.paneGrids.has(name)) {
        const frame = [...ancestors].reverse().find(entry => {
          const frameName = grammarName(entry.element);
          return frameName === SURFACE_VOCABULARY.pane || frameName === SURFACE_VOCABULARY.page || SURFACE_VOCABULARY.cards.has(frameName ?? '');
        });
        const frameName = frame ? grammarName(frame.element) : null;
        if (frame && frameName !== SURFACE_VOCABULARY.pane) {
          const chrome = frame.element.attributes.get('chrome');
          const open = frameName === SURFACE_VOCABULARY.page && (chrome === undefined ? hasSpread(frame.element) : chrome.text === null);
          const panes = frameName === SURFACE_VOCABULARY.page && chrome?.text === 'panes';
          if (!open && !panes) report(element, frame.element, 'grid-outside-panes', `${name} is drawn inside ${describe(frame.element)}`, ancestors, stack);
        }
      }
      if (element.repeated) {
        const inGrid = [...ancestors].reverse().find(entry => isGrammarIn(entry.element, SURFACE_VOCABULARY.grids));
        const card = inGrid?.element.attributes.get('kind')?.text === 'cards' ? cardOf(graph, element) : null;
        if (inGrid && card && card.attributes.has('label')) {
          report(element, inGrid.element, 'label-in-grid', `${describe(element)} repeats a labelled card in a Grid kind="cards": a repeated tile has no label`, ancestors, stack);
        }
      }
    },
    parent(element, drawn, ancestors, stack) {
      if (!isGrammarIn(element, SURFACE_VOCABULARY.sections) || element.attributes.get('kind')?.text === 'list' || drawn.length !== 1) return;
      const only = drawn[0] as RenderElement;
      if (cardOf(graph, only)) report(only, element, 'heading-over-card', `${describe(only)} is the only thing in a Section: the card has two titles`, ancestors, stack);
    },
    siblings(elements, ancestors, stack) {
      for (let index = 0; index < elements.length - 1; index += 1) {
        const heading = elements[index] as RenderElement;
        if (!isGrammarIn(heading, SURFACE_VOCABULARY.headings)) continue;
        const next = elements[index + 1] as RenderElement;
        const after = elements[index + 2];
        if (!cardOf(graph, next) || (after && cardOf(graph, after))) continue;
        report(next, heading, 'heading-over-card', `${describe(next)} stands directly under a ${heading.tag.name}, so the card has two titles`, ancestors, stack);
      }
    },
  };

  const components = graph.allComponents();
  for (const component of components) graph.walkFrom(component, visitor);
  return { violations: [...found.values()], coverage: { status: 'checked', components: components.length } };
}

const hasSpread = (element: RenderElement): boolean => element.attributes.has('...');
