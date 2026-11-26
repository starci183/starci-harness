import type { Meta, StoryObj } from '@storybook/react-vite';
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

/** An in-page state: an icon on the accent soft circle, a no-match after a filter, a primary and a secondary action. */
export const RegionState: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="empty list: icon, title, description, one primary" direction="column">
        <G.EmptyNotice message="No customers yet" description="Add the first customer to see them here." media={{ icon: BookGlyph }} actionLabel="Add customer" onAction={noop} />
      </State>
      <State label="no match after a filter: primary and secondary" direction="column">
        <G.EmptyNotice message="No results for these filters" description="Try a wider date range." actionLabel="Clear filters" actionVariant="border" onAction={noop} secondary={{ label: 'Change the range', onPress: noop }} />
      </State>
    </Matrix>
  ),
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
};

/** A page-level state with no art falls back to the icon; a failed illustration keeps the stack and the actions. */
export const PageStateWithoutArt: Story = {
  parameters: { grammar: { catalog: true } },
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
};

/** The not-found page every web app carries (gallery screen errors/not-found): the page-level state with one way home. */
export const NotFoundPage: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <G.StaticsProvider baseUrl="/media">
      <G.EmptyNotice scope="page" message="Page not found" description="The address you opened does not exist or has moved." media={{ illustration: { staticsKey: 'art-square.svg' } }} actionLabel="Back to the home page" actionHref="/" />
    </G.StaticsProvider>
  ),
};

/** The server-error page every web app carries (gallery screen errors/server-error): home as the primary, retry as the secondary. */
export const ServerErrorPage: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <G.StaticsProvider baseUrl="/media">
      <G.EmptyNotice scope="page" message="Something went wrong" description="We could not show this page. You can try again or go back to the home page." media={{ illustration: { staticsKey: 'art-square.svg' } }} actionLabel="Back to the home page" actionHref="/" secondary={{ label: 'Try again', onPress: noop }} />
    </G.StaticsProvider>
  ),
};

const FIRST_RUN_STEPS: ReadonlyArray<G.EmptyNoticeStep> = [
  { id: 'drive', label: 'Connect your Google Drive', description: 'Your files stay where they are.', isDone: true },
  { id: 'sheet', label: 'Pick the customer sheet', description: 'The first row holds the column names.' },
  { id: 'invite', label: 'Invite your team' },
];

/**
 * A first-run notice with numbered steps (0.46.2), two to five. A finished step wears a check, the first OPEN step is the current one (the accent number) and carries the
 * notice's one primary action under its words, and the later steps are grey numbers. The steps read from the start edge inside the centred stack.
 */
export const FirstRunSteps: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="steps: one done, the second carries the action" direction="column">
        <G.EmptyNotice message="Set up your workspace" description="Three steps and your customers appear here." media={{ icon: BookGlyph }} steps={FIRST_RUN_STEPS} actionLabel="Pick the sheet" onAction={noop} secondary={{ label: 'Skip for now', onPress: noop }} />
      </State>
      <State label="every step done: the action stands where a plain notice draws it" direction="column">
        <G.EmptyNotice message="All set up" steps={FIRST_RUN_STEPS.slice(0, 2).map((step) => ({ ...step, isDone: true }))} actionLabel="Open the customers" actionVariant="border" onAction={noop} />
      </State>
    </Matrix>
  ),
};

/** The good-news state (0.46.2): nothing needs the reader. A success mark, the words, and no action (the type refuses every action prop on it). */
export const AllClear: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="all clear: success mark, no action" direction="column">
        <G.EmptyNotice isAllClear message="You are all caught up" description="Nothing is waiting for your approval." />
      </State>
    </Matrix>
  ),
};
