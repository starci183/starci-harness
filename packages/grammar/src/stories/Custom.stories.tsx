import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * CUSTOM (0.49.0), the escape hatch. A region where anything goes: any markup, any class name, any library (a graph editor such as
 * @xyflow/react, an animation library such as motion) because no Grammar component fits. The Grammar draws nothing inside it and
 * the Grammar lint rules report nothing inside it; the rest of the page still follows the Grammar. It names its `reason`
 * (stamped as `data-grammar-custom-reason`, listed by `starci-custom-inventory`). The Grammar itself imports no graph and no
 * animation library, so these stories draw with plain SVG and CSS.
 */
const meta: Meta = { title: 'Surfaces/Custom, the escape hatch (0.49.0)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const region = (root: ParentNode, selector = '[data-component="Custom"]'): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element for ${selector}`);
  return found;
};

/** The default region is a `div` that stamps its reason and adds no paint, inset or radius of its own. */
export const DefaultRegion: Story = {
  render: () => (
    <G.SurfaceCard label="A hand-drawn chart">
      <G.Custom reason="story: hand-placed art" className="story-custom-art">
        <svg viewBox="0 0 120 40" width="240" height="80" role="img" aria-label="A trend line">
          <polyline points="0,32 30,24 60,28 90,10 120,14" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </G.Custom>
    </G.SurfaceCard>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const custom = region(canvasElement);
      expect(custom.tagName).toBe('DIV');
      expect(custom.getAttribute('data-grammar-custom-reason')).toBe('story: hand-placed art');
      expect(custom.classList.contains('story-custom-art')).toBe(true);
      const style = getComputedStyle(custom);
      expect(style.boxShadow).toBe('none');
      expect(style.borderTopWidth).toBe('0px');
      expect(style.paddingTop).toBe('0px');
    });
  },
};

/** `as` picks the element the region renders, and the attributes of that element pass through. */
export const AsAnotherElement: Story = {
  render: () => (
    <G.Custom as="section" reason="story: a landmark the app owns" aria-label="Graph canvas" id="story-custom-section" data-story-custom="section">
      <p>An app-owned canvas lives here: a flow editor, a map, a chart toolkit.</p>
    </G.Custom>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const custom = region(canvasElement, '[data-story-custom="section"]');
      expect(custom.tagName).toBe('SECTION');
      expect(custom.getAttribute('aria-label')).toBe('Graph canvas');
      expect(custom.id).toBe('story-custom-section');
      expect(custom.getAttribute('data-component')).toBe('Custom');
    });
  },
};

/** A Grammar component inside a region keeps its own look: Custom is a region, not a theme. */
export const GrammarInside: Story = {
  render: () => (
    <G.Custom reason="story: custom frame around Grammar parts">
      <G.Button intent="commit">Run</G.Button>
    </G.Custom>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const custom = region(canvasElement);
      expect(custom.querySelector('[data-component="Button"]')).not.toBeNull();
    });
  },
};
