import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { BookGlyph, Matrix, State, noop } from './fixtures.js';

/**
 * The one empty state: a centred stack of media, title, description and actions (one primary, at most one secondary). The media follows the
 * scope of the state: an in-page state (`scope="region"`, the default) wears an icon on a soft brand-tone circle; a page-level state
 * (`scope="page"`: first visit, empty page, paywall, 404, 500) wears a decorative illustration, 160px at 1440 and 120px below 48rem.
 */
const meta: Meta = { title: 'Media/Empty state', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const boxOf = (root: HTMLElement, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element for ${selector}`);
  return found;
};

/** An in-page state: an icon on the accent soft circle, a no-match after a filter, a primary and a secondary action. */
export const RegionState: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="empty list: icon, title, description, one primary" direction="column">
        <G.EmptyNotice message="No customers yet" description="Add the first customer to see them here." media={{ icon: BookGlyph }} actionLabel="Add customer" onAction={noop} />
      </State>
      <State label="no match after a filter: primary and secondary" direction="column">
        <G.EmptyNotice message="No results for these filters" description="Try a wider date range." actionLabel="Clear filters" actionIntent="neutral" onAction={noop} secondary={{ label: 'Change the range', onPress: noop }} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const notices = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="EmptyNotice"]')];
    expect(notices).toHaveLength(2);
    for (const notice of notices) {
      expect(notice.getAttribute('data-grammar-empty-scope')).toBe('region');
      expect(notice.getAttribute('data-grammar-empty-mark')).toBe('icon');
      expect(notice.querySelector('[data-component="Illustration"]')).toBeNull();
      const tile = boxOf(notice, '.starci-core-icon-tile');
      expect(tile.getAttribute('data-tone')).toBe('accent');
      expect(getComputedStyle(tile).borderTopLeftRadius).not.toBe('0px');
    }
    expect(notices[1]?.querySelectorAll('.starci-core-notice-actions button').length).toBe(2);
  },
};

/** A page-level state: the illustration (a statics key) over the title, the description and the actions. */
export const PageState: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <G.StaticsProvider baseUrl="/media">
      <G.EmptyNotice
        scope="page"
        message="Welcome. Nothing here yet"
        description="Create your first project to start."
        media={{ illustration: { staticsKey: 'art-square.svg', assetSlot: 'empty.first-visit' } }}
        actionLabel="Create a project"
        onAction={noop}
        secondary={{ label: 'Read the guide', href: '#guide' }}
      />
    </G.StaticsProvider>
  ),
  play: async ({ canvasElement }) => {
    const notice = boxOf(canvasElement, '[data-component="EmptyNotice"]');
    expect(notice.getAttribute('data-grammar-empty-scope')).toBe('page');
    expect(notice.getAttribute('data-grammar-empty-mark')).toBe('illustration');
    const art = boxOf(notice, '[data-component="Illustration"]');
    expect(art.getAttribute('aria-hidden')).toBe('true');
    expect(art.getAttribute('data-asset-slot')).toBe('empty.first-visit');
    await waitFor(() => expect(boxOf(art, 'img').getAttribute('src')).toBe('/media/art-square.svg'));
    const compact = window.matchMedia('(max-width: 47.999rem)').matches;
    const box = art.getBoundingClientRect();
    expect(Math.round(box.width)).toBe(compact ? 120 : 160);
    expect(Math.round(box.height)).toBe(compact ? 120 : 160);
    // the stack is centred: the art, the copy and the actions share one centre line
    const centre = (element: Element) => { const rect = element.getBoundingClientRect(); return rect.left + rect.width / 2; };
    const copy = boxOf(notice, '.starci-core-notice-copy');
    expect(Math.abs(centre(art) - centre(copy))).toBeLessThan(2);
    // the primary is a button; the secondary is a neutral destination
    expect(notice.querySelectorAll('.starci-core-notice-actions > *').length).toBe(2);
    expect(boxOf(notice, '.starci-core-notice-actions a[href="#guide"]')).not.toBeNull();
  },
};

/** A page-level state with no art falls back to the icon; a failed illustration keeps the stack and the actions. */
export const PageStateWithoutArt: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="scope page, an icon" direction="column">
        <G.EmptyNotice scope="page" message="This page could not be found" description="Check the address, or go back." media={{ icon: BookGlyph }} actionLabel="Back to the home page" actionHref="/" />
      </State>
      <State label="scope page, illustration that fails to load" direction="column">
        <G.EmptyNotice scope="page" message="Something went wrong" description="Try again in a moment." media={{ illustration: { src: '/media/missing.svg' } }} actionLabel="Back to the home page" actionHref="/" secondary={{ label: 'Try again', onPress: noop }} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-grammar-illustration-state="error"]')).not.toBeNull());
    const notices = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="EmptyNotice"]')];
    expect(notices[0]?.getAttribute('data-grammar-empty-mark')).toBe('icon');
    expect(notices[1]?.querySelectorAll('.starci-core-notice-actions > *').length).toBe(2);
  },
};
