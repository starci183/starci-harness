import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/** ARTICLE-HEADINGS-14 (0.37.14): h2 to h4 of a MarkdownArticle are 14 (type law 14/12), ranked by weight and tone; the heading elements stay. */
const meta: Meta = { title: 'Surfaces/Markdown headings' };
export default meta;
type Story = StoryObj;

export const ArticleHeadings: Story = {
  render: () => (
    <div style={{ inlineSize: 420 }}>
      <G.MarkdownArticle>
        <h2>The résumé of HTTP</h2>
        <p>A request travels from the browser to the server and back, naïve and façade-free.</p>
        <h3>Methods</h3>
        <p>GET reads, POST writes.</p>
        <h4>Status codes</h4>
        <p>200 means success.</p>
      </G.MarkdownArticle>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const sizes = ['h2', 'h3', 'h4'].map((tag) => getComputedStyle(canvasElement.querySelector(tag)!).fontSize);
      expect(sizes).toEqual(['14px', '14px', '14px']);
      const weights = ['h2', 'h3', 'h4'].map((tag) => Number(getComputedStyle(canvasElement.querySelector(tag)!).fontWeight));
      expect(weights[0]!).toBeGreaterThan(weights[1]!);
    });
  },
};
