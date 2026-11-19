import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * FRAGMENT (0.49.0), the escape hatch. A region where anything goes: any markup, any class name, any library (a graph editor such as
 * @xyflow/react, an animation library such as motion) because no Grammar component fits. Like React's Fragment it renders no
 * element, only its children, so it adds no paint, inset or radius and nothing in the DOM. The Grammar lint rules report nothing
 * inside it; the rest of the page still follows the Grammar. It names its `reason`, which serves the lint and the inventory
 * (`starci-fragment-inventory`). The Grammar itself imports no graph and no animation library, so these stories draw with plain SVG.
 * A file that also needs React's Fragment imports this one as `import { Fragment as GrammarFragment } from "@starci/grammar"`.
 */
const meta: Meta = { title: 'Surfaces/Fragment, the escape hatch (0.49.0)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const host = (root: ParentNode): HTMLElement => {
  const found = root.querySelector<HTMLElement>('[data-story-fragment]');
  if (found === null) throw new Error('no story host');
  return found;
};

/** The region renders its children and no element of its own: the host's only child is the app's own SVG. */
export const NoWrapperElement: Story = {
  render: () => (
    <div data-story-fragment="plain">
      <G.Fragment reason="story: hand-drawn chart">
        <svg viewBox="0 0 120 40" width="240" height="80" role="img" aria-label="A trend line" data-story-art="true">
          <polyline points="0,32 30,24 60,28 90,10 120,14" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </G.Fragment>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const el = host(canvasElement);
      expect(el.children.length).toBe(1);
      expect(el.firstElementChild?.getAttribute('data-story-art')).toBe('true');
      expect(el.querySelector('[data-component="Fragment"]')).toBeNull();
    });
  },
};

/** A Grammar component inside a region keeps its own look: Fragment is a region for the lint, not a theme. */
export const GrammarInside: Story = {
  render: () => (
    <div data-story-fragment="grammar">
      <G.Fragment reason="story: Grammar parts beside app code">
        <G.Button intent="commit">Run</G.Button>
      </G.Fragment>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const el = host(canvasElement);
      expect(el.firstElementChild?.getAttribute('data-component')).toBe('Button');
    });
  },
};
