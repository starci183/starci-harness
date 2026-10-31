import type { Meta, StoryObj } from '@storybook/react-vite';
import { Chip as HeroChip } from '@heroui/react';
import { useState } from 'react';
import { waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import {
  BellGlyph,
  BookGlyph,
  ChartGlyph,
  Matrix,
  SearchGlyph,
  SettingsGlyph,
  StarGlyph,
  TrashGlyph,
  State,
  familyScope,
  noop,
  placeholderImage,
} from './fixtures.js';
import turtleUrl from './assets/turtle.png';

/**
 * Primitives: the atoms every family restyles. Each story renders one Common renderer in its
 * relevant states (default, disabled, invalid, pending, selected/current, skeleton) inside the
 * family root chosen in the toolbar.
 */
const meta: Meta = {
  title: 'Primitives',
};
export default meta;

type Story = StoryObj;

/** Story data picks the instants once; RelativeTime alone owns the updating clock. */
const RelativeTimeDemo = () => {
  const [startedAt] = useState(Date.now);
  return (
    <Matrix>
      <State label="Relative time" direction="column">
        <G.RelativeTime dateTime={new Date(startedAt - 5 * 60 * 1000).toISOString()} locale="en" />
        <G.RelativeTime dateTime={new Date(startedAt - 5 * 60 * 1000).toISOString()} locale="fr" />
      </State>
      <State label="Countdown, shared clock" direction="column">
        <G.RelativeTime dateTime={new Date(startedAt + 90 * 1000).toISOString()} locale="en" mode="countdown" />
        <G.RelativeTime dateTime={new Date(startedAt + 30 * 1000).toISOString()} locale="en" mode="countdown" />
      </State>
      <State label="Digital countdown and serializable template" direction="column">
        <G.RelativeTime id="relative-time-digital-minutes" dateTime={new Date(startedAt + 90 * 1000).toISOString()} locale="en" mode="countdown" format="digital" template="Ends in {time}" expiredLabel="Offer ended" />
        <G.RelativeTime id="relative-time-digital-hours" dateTime={new Date(startedAt + 3661 * 1000).toISOString()} locale="en" mode="countdown" format="digital" template="Time left: {time}" />
      </State>
      <State label="Expired countdown" direction="column">
        <G.RelativeTime dateTime="2020-01-01T00:00:00Z" locale="en" mode="countdown" />
        <G.RelativeTime id="relative-time-expired" dateTime="2020-01-01T00:00:00Z" locale="en" mode="countdown" format="digital" template="Ends in {time}" expiredLabel="Offer ended" />
      </State>
      <State label="Fractional timestamp and compact offset" direction="column">
        <G.RelativeTime id="relative-time-fraction" dateTime="2026-10-25T12:00:00.123456789Z" locale="en" />
        <G.RelativeTime id="relative-time-offset" dateTime="2026-10-25T12:00:00+0000" locale="en" />
        <G.RelativeTime id="relative-time-short-fraction-offset" dateTime="2026-10-25T12:00:00.1-0730" locale="en" />
      </State>
      <State label="Stable server fallback" direction="column">
        <G.RelativeTime dateTime="2026-10-25T12:00:00+07:00" locale="en" fallback="Updated recently" />
      </State>
      <State label="Invalid timestamp fallback" direction="column">
        <G.RelativeTime id="relative-time-invalid" dateTime="not-an-instant" locale="en" fallback="Time unavailable" />
      </State>
    </Matrix>
  );
};

export const RelativeTime: Story = {
  render: () => <RelativeTimeDemo />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      if (!/^Ends in 1:[0-5]\d$/.test(canvasElement.querySelector('#relative-time-digital-minutes')?.textContent ?? '')) throw new Error('Digital minutes must use m:ss within the serializable template');
      if (!/^Time left: 1:0[01]:[0-5]\d$/.test(canvasElement.querySelector('#relative-time-digital-hours')?.textContent ?? '')) throw new Error('Digital hours must use h:mm:ss within the serializable template');
      if (canvasElement.querySelector('#relative-time-expired')?.textContent !== 'Offer ended') throw new Error('Expired countdown must replace the complete template');
      if (canvasElement.querySelector('#relative-time-invalid')?.textContent !== 'Time unavailable') throw new Error('Invalid timestamps must render fallback');
      if (canvasElement.querySelector('#relative-time-fraction')?.getAttribute('datetime') !== '2026-10-25T12:00:00.123Z') throw new Error('RFC 3339 fractions must be accepted');
      if (canvasElement.querySelector('#relative-time-offset')?.getAttribute('datetime') !== '2026-10-25T12:00:00.000Z') throw new Error('Compact timezone offsets must be accepted');
      if (canvasElement.querySelector('#relative-time-short-fraction-offset')?.getAttribute('datetime') !== '2026-10-25T19:30:00.100Z') throw new Error('Short fractions and compact negative offsets must normalize to portable ISO timestamps');
    });
  },
};

const countdownCases = [
  { label: '25 hours', seconds: 25 * 60 * 60, expected: 'in 1 day' },
  { label: '61 minutes', seconds: 61 * 60, expected: 'in 1 hour' },
  { label: '8 days', seconds: 8 * 24 * 60 * 60, expected: 'in 1 week' },
  { label: '31 days', seconds: 31 * 24 * 60 * 60, expected: 'in 1 month' },
  { label: '90 seconds', seconds: 90, expected: 'in 1 minute' },
] as const;

const RelativeTimeCountdownTable = () => {
  const [startedAt] = useState(Date.now);
  return <Matrix>
    {countdownCases.map(({ label, seconds, expected }, index) => <State key={label} label={`${label}: ${expected}`} direction="column">
      <G.RelativeTime id={`relative-time-countdown-${index}`} dateTime={new Date(startedAt + seconds * 1000).toISOString()} locale="en" mode="countdown" />
    </State>)}
  </Matrix>;
};

/** The remaining seconds choose the unit; a partial day, hour, week or month never rounds upward. */
export const RelativeTimeCountdown: Story = {
  render: () => <RelativeTimeCountdownTable />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      countdownCases.forEach(({ label, expected }, index) => {
        const actual = canvasElement.querySelector(`#relative-time-countdown-${index}`)?.textContent;
        if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
      });
    });
  },
};

export const Badge: Story = {
  render: () => (
    <Matrix>
      <State label="Tones">
        <G.Badge>Neutral</G.Badge>
        <G.Badge tone="accent">Accent</G.Badge>
        <G.Badge tone="success">Success</G.Badge>
        <G.Badge tone="warning">Warning</G.Badge>
        <G.Badge tone="danger">Danger</G.Badge>
        <G.Badge tone="muted">Muted</G.Badge>
      </State>
      <State label="With leading content">
        <G.Badge tone="accent" startContent={<G.Icon source={StarGlyph} usage="chip" />}>Featured</G.Badge>
      </State>
      <State label="Status dot (isDot)">
        <G.Badge isDot>Idle</G.Badge>
        <G.Badge tone="success" isDot>Online</G.Badge>
        <G.Badge tone="warning" isDot>Degraded</G.Badge>
        <G.Badge tone="danger" isDot>Down</G.Badge>
        <G.Badge tone="muted" isDot>paused</G.Badge>
      </State>
      <State label="Skeleton (pending)">
        <G.Badge isSkeleton>Loading</G.Badge>
      </State>
    </Matrix>
  ),
};

const DOT_SIZES = ['sm', 'md', 'lg'] as const;
const DOT_TONES = ['neutral', 'accent', 'success', 'warning', 'danger'] as const;
const PADDING_SIDES = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;

export const StatusDot: Story = {
  render: () => (
    <Matrix>
      <State label="With text, beside HeroUI Chip at each size" direction="column">
        {DOT_SIZES.map((size) => (
          <div key={size} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ width: '2rem' }}>{size}</span>
            <G.StatusDot size={size} tone="success">online</G.StatusDot>
            <HeroChip size={size} color="success" variant="soft">Online</HeroChip>
          </div>
        ))}
      </State>
      <State label="With text, tones">
        {DOT_TONES.map((tone) => <G.StatusDot key={tone} tone={tone}>{tone}</G.StatusDot>)}
      </State>
      <State label="Echo (dot with an expanding ring)">
        {DOT_TONES.map((tone) => <G.StatusDot key={tone} tone={tone} echo aria-label={`Live, ${tone}`} />)}
      </State>
      <State label="Static (dot only)">
        {DOT_TONES.map((tone) => <G.StatusDot key={tone} tone={tone} aria-label={`Status, ${tone}`} />)}
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      for (const size of DOT_SIZES) {
        const dot = canvasElement.querySelector(`.starci-core-status-dot-chip[data-size="${size}"]`);
        const chip = dot?.nextElementSibling;
        if (!(dot instanceof HTMLElement) || !(chip instanceof HTMLElement)) throw new Error(`${size}: StatusDot and Chip must both render`);
        const dotStyle = getComputedStyle(dot);
        const chipStyle = getComputedStyle(chip);
        for (const side of PADDING_SIDES) {
          // The sm chip pads 8px inline (HeroUI's sm Chip pads 4px), so a status word clears the pill edge.
          const expected = size === 'sm' && (side === 'paddingLeft' || side === 'paddingRight') ? '8px' : chipStyle[side];
          if (dotStyle[side] !== expected) throw new Error(`${size}: ${side} ${dotStyle[side]} differs from ${expected}`);
        }
        if (dot.getBoundingClientRect().height !== chip.getBoundingClientRect().height) throw new Error(`${size}: height ${dot.getBoundingClientRect().height} differs from Chip ${chip.getBoundingClientRect().height}`);
        const label = dot.querySelector('.starci-core-status-dot-label');
        if (!label || !/^\p{Lu}/u.test(label.textContent ?? '')) throw new Error(`${size}: the label's first letter must be uppercase`);
        const mark = dot.querySelector('.starci-core-status-dot-mark');
        if (!(mark instanceof HTMLElement) || !(label instanceof HTMLElement)) throw new Error(`${size}: dot and label must render`);
        const gap = label.getBoundingClientRect().left - mark.getBoundingClientRect().right;
        if (Math.abs(gap - 4) > 0.5) throw new Error(`${size}: dot-to-text gap is ${gap}px, expected 4px`);
      }
      for (const dot of canvasElement.querySelectorAll('[data-component="StatusDot"][data-variant="echo"], [data-component="StatusDot"][data-variant="static"]')) {
        if (!dot.getAttribute('aria-label')) throw new Error('A dot-only StatusDot needs an aria-label');
      }
    });
  },
};

const TerminalDemo = () => {
  const [count, setCount] = useState(12);
  const lines = Array.from({ length: count }, (_, index) => `[${String(index).padStart(3, '0')}] step ${index + 1} done`);
  return (
    <Matrix maxWidth={520}>
      <State label="Log tail (follows the end)" direction="column">
        <G.Terminal title="Deploy log" lines={lines} />
        <G.Button intent="neutral" onPress={() => setCount((value) => value + 5)}>Append lines</G.Button>
      </State>
      <State label="Without a title" direction="column">
        <G.Terminal label="Build output" lines={['$ npm run build', 'ok']} />
      </State>
    </Matrix>
  );
};

export const Terminal: Story = {
  render: () => <TerminalDemo />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const log = canvasElement.querySelector('[role="log"]');
      if (!(log instanceof HTMLElement)) throw new Error('Terminal must render role="log"');
      if (log.getAttribute('aria-live') !== 'polite') throw new Error('Terminal must be aria-live polite');
      if (log.scrollHeight > log.clientHeight && log.scrollHeight - log.scrollTop - log.clientHeight > 8) throw new Error('Terminal must open scrolled to the end');
    });
  },
};

export const Button: Story = {
  render: () => (
    <Matrix>
      <State label="Variants">
        <G.Button variant="primary">Primary</G.Button>
        <G.Button variant="secondary">Secondary</G.Button>
        <G.Button variant="tertiary">Tertiary</G.Button>
        <G.Button variant="outline">Outline</G.Button>
        <G.Button variant="ghost">Ghost</G.Button>
        <G.Button variant="danger">Danger</G.Button>
        <G.Button variant="danger-soft">Danger soft</G.Button>
      </State>
      <State label="Sizes">
        <G.Button size="sm">Small</G.Button>
        <G.Button size="md">Medium</G.Button>
        <G.Button size="lg">Large</G.Button>
      </State>
      <State label="Disabled">
        <G.Button variant="primary" isDisabled>Primary</G.Button>
        <G.Button variant="secondary" isDisabled>Secondary</G.Button>
        <G.Button variant="outline" isDisabled>Outline</G.Button>
      </State>
      <State label="Pending">
        <G.Button variant="primary" isPending>Saving</G.Button>
        <G.Button variant="secondary" isPending>Loading</G.Button>
      </State>
      <State label="Skeleton">
        <G.Button isSkeleton>Loading</G.Button>
      </State>
      <State label="With icons, destination and fill width" direction="column">
        <G.Button variant="secondary" startContent={<G.Icon source={SearchGlyph} usage="leading" />}>Search</G.Button>
        <G.Button href="#destination" variant="outline">Destination link</G.Button>
        <G.Button variant="primary" width="fill">Full width</G.Button>
      </State>
    </Matrix>
  ),
};

export const Divider: Story = {
  render: () => (
    <Matrix maxWidth={480}>
      <State label="Labelled divider" direction="column">
        <G.Divider label="or" />
        <G.Divider label="Continue with" />
      </State>
      <State label="Unlabelled hairline (separator / presentation)" direction="column">
        <G.Divider />
        <G.Divider semantics="presentation" />
      </State>
      <State label="Vertical hairline between touching columns" direction="row">
        <div style={{ display: 'flex', height: '3rem', gap: 0 }}>
          <G.Text>Left</G.Text>
          <G.Divider orientation="vertical" semantics="presentation" />
          <G.Text>Right</G.Text>
        </div>
      </State>
    </Matrix>
  ),
};

export const Region: Story = {
  render: () => (
    <Matrix maxWidth={480}>
      <State label="Named by its own heading, with room below" direction="column">
        <G.Region id="region-story" labelledBy="region-story-title" spacing="spaced">
          <G.SectionHeader id="region-story-title" title="Sharing" level={2} />
        </G.Region>
      </State>
      <State label="Section landmark" direction="column">
        <G.Region label="Privacy"><G.Text>A section landmark with no card around it.</G.Text></G.Region>
      </State>
    </Matrix>
  ),
};

export const NavLandmark: Story = {
  render: () => (
    <Matrix maxWidth={480}>
      <State label="Bar" direction="column">
        <G.NavLandmark label="Primary" layout="bar"><G.Link href="#a">Catalogue</G.Link><G.Link href="#b">About</G.Link></G.NavLandmark>
      </State>
      <State label="Scrolling" direction="column">
        <G.NavLandmark label="Sections" layout="scrolling"><G.Link href="#a">Overview</G.Link><G.Link href="#b">Details</G.Link></G.NavLandmark>
      </State>
    </Matrix>
  ),
};

export const List: Story = {
  render: () => (
    <Matrix maxWidth={480}>
      <State label="Unordered" direction="column">
        <G.List label="Members"><G.ListItem>Ada</G.ListItem><G.ListItem>Grace</G.ListItem></G.List>
      </State>
      <State label="Ordered" direction="column">
        <G.List as="ol" label="Steps"><G.ListItem>First</G.ListItem><G.ListItem>Second</G.ListItem></G.List>
      </State>
    </Matrix>
  ),
};

export const ListItem: Story = {
  render: () => (
    <Matrix maxWidth={480}>
      <State label="One row of a List" direction="column">
        <G.List label="Members"><G.ListItem>Ada</G.ListItem></G.List>
      </State>
    </Matrix>
  ),
};

export const Heading: Story = {
  render: () => (
    <Matrix>
      <State label="Levels" direction="column">
        <G.Heading level={1}>Heading level 1</G.Heading>
        <G.Heading level={2}>Heading level 2</G.Heading>
        <G.Heading level={3}>Heading level 3</G.Heading>
        <G.Heading level={4}>Heading level 4</G.Heading>
      </State>
      <State label="Display scale" direction="column">
        <G.Heading level={2} scale="display">Display heading</G.Heading>
      </State>
      <State label="Skeleton and visually hidden" direction="column">
        <G.Heading level={3} isSkeleton>Loading heading</G.Heading>
        <G.Heading level={3} isVisuallyHidden>Only announced to assistive technology</G.Heading>
      </State>
    </Matrix>
  ),
};

export const Icon: Story = {
  render: () => (
    <Matrix>
      <State label="Usages (decorative)">
        <G.Icon source={SearchGlyph} usage="heading" />
        <G.Icon source={SearchGlyph} usage="leading" />
        <G.Icon source={SearchGlyph} usage="chip" />
      </State>
      <State label="Meaningful (labelled)">
        <G.Icon source={BellGlyph} ariaLabel="Notifications" usage="leading" />
      </State>
      <State label="Skeleton">
        <G.Icon source={SearchGlyph} isSkeleton />
      </State>
    </Matrix>
  ),
};

export const IconButton: Story = {
  render: () => (
    <Matrix>
      <State label="Default">
        <G.IconButton source={SearchGlyph} label="Search" onPress={noop} />
        <G.IconButton source={SettingsGlyph} label="Settings" onPress={noop} />
        <G.IconButton source={SearchGlyph} label="Search (a destination)" href="#search" />
      </State>
      <State label="Active (selected)">
        <G.IconButton source={BellGlyph} label="Notifications" isActive onPress={noop} />
      </State>
      <State label="Quiet (ghost) - an overflow menu glyph">
        <G.IconButton source={SettingsGlyph} label="More actions" variant="ghost" onPress={noop} />
      </State>
      <State label="Danger-soft - a reversible or row-level delete (an AlertDialog confirm uses the solid danger Button)">
        <G.IconButton source={TrashGlyph} label="Delete row" variant="danger-soft" onPress={noop} />
        <G.IconButton source={TrashGlyph} label="Delete row unavailable" variant="danger-soft" isDisabled />
      </State>
      <State label="Disabled">
        <G.IconButton source={SearchGlyph} label="Search unavailable" isDisabled />
      </State>
      <State label="Skeleton">
        <G.IconButton source={SearchGlyph} label="Loading" isSkeleton />
      </State>
    </Matrix>
  ),
};

export const IconTile: Story = {
  render: () => (
    <Matrix>
      <State label="Tones">
        <G.IconTile source={BookGlyph} />
        <G.IconTile source={BookGlyph} tone="accent" />
        <G.IconTile source={ChartGlyph} tone="success" />
        <G.IconTile source={BellGlyph} tone="warning" />
        <G.IconTile source={SettingsGlyph} tone="danger" ariaLabel="Needs attention" />
      </State>
      <State label="Sizes">
        <G.IconTile source={StarGlyph} size="sm" tone="accent" />
        <G.IconTile source={StarGlyph} size="md" tone="accent" />
      </State>
      <State label="Skeleton">
        <G.IconTile source={StarGlyph} isSkeleton />
      </State>
    </Matrix>
  ),
};

export const IncludedMark: Story = {
  render: () => (
    <Matrix>
      <State label="Decorative and labelled">
        <G.IncludedMark />
        <G.IncludedMark label="Included" />
        <G.Text startContent={<G.IncludedMark />}>Offline access</G.Text>
      </State>
    </Matrix>
  ),
};

export const Label: Story = {
  render: () => (
    <Matrix>
      <State label="Depths" direction="column">
        <G.Label>Top-level label</G.Label>
        <G.Label depth="nested">Nested label</G.Label>
        <G.Label as="h3">Label as heading</G.Label>
      </State>
    </Matrix>
  ),
};

export const LeadingNumber: Story = {
  render: () => (
    <Matrix>
      <State label="Positions">
        <G.LeadingNumber position={1} />
        <G.LeadingNumber position={2} />
        <G.LeadingNumber position={12} />
      </State>
    </Matrix>
  ),
};

export const Progress: Story = {
  render: () => (
    <Matrix maxWidth={420}>
      <State label="Determinate" direction="column">
        <G.Progress label="Upload" value={0} />
        <G.Progress label="Course progress" value={45} />
        <G.Progress label="Complete" value={100} />
      </State>
      <State label="Tones and a spoken reading (aria-valuetext)" direction="column">
        <G.Progress label="Indexing" value={47} valueText="56 of 120 chunks, paused" tone="warning" />
        <G.Progress label="Indexing" value={100} valueText="120 of 120 chunks" tone="success" />
        <G.Progress label="Indexing" value={30} valueText="36 of 120 chunks, failed" tone="danger" />
        <G.Progress label="Indexing" value={60} valueText="72 of 120 chunks" tone="info" />
        <G.Progress label="Upload steps" steps={{ total: 5, completed: 2 }} valueText="Step 2 of 5, paused" tone="warning" />
      </State>
      <State label="Indeterminate (pending)" direction="column">
        <G.Progress label="Preparing" />
      </State>
      <State label="Skeleton" direction="column">
        <G.Progress label="Loading" isSkeleton />
      </State>
    </Matrix>
  ),
};

export const RankArtwork: Story = {
  render: () => (
    <Matrix>
      <State label="Kinds">
        <G.RankArtwork kind="first" label="First place" width={48} height={48} />
        <G.RankArtwork kind="second" label="Second place" width={48} height={48} />
        <G.RankArtwork kind="third" label="Third place" width={48} height={48} />
        <G.RankArtwork kind="cup" label="Trophy" width={48} height={48} />
      </State>
    </Matrix>
  ),
};

export const StateMark: Story = {
  render: () => (
    <Matrix>
      <State label="Presentation states">
        {G.PRESENTATION_STATES.map((state) => (
          <span key={state} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
            <G.StateMark state={state} />
            <G.Text size="sm">{state}</G.Text>
          </span>
        ))}
      </State>
    </Matrix>
  ),
};

export const Text: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="Tones" direction="column">
        <G.Text>Default body text.</G.Text>
        <G.Text tone="muted">Muted supporting text.</G.Text>
        <G.Text tone="accent">Accent text.</G.Text>
      </State>
      <State label="Sizes and weights" direction="column">
        <G.Text size="xs">Extra small</G.Text>
        <G.Text size="sm" weight="medium">Small medium</G.Text>
        <G.Text size="md" weight="semibold">Medium semibold</G.Text>
        <G.Text size="metric-lead" weight="semibold">1,284</G.Text>
      </State>
      <State label="Monospace, tabular figures and inline code" direction="column">
        <G.Text mono>0f3a9c1 · packages/grammar/src</G.Text>
        <G.Text tabular>1,111 / 8,888 — digits keep one width</G.Text>
        <G.Text mono tabular size="sm">00:01:07.250</G.Text>
        <G.Text>Run <G.Code>npm run build</G.Code> before you publish.</G.Text>
      </State>
      <State label="Overflow" direction="column">
        <G.Text overflow="truncate">A long sentence that is truncated to a single line when it runs out of room in its container.</G.Text>
        <G.Text overflow="clamp-2">A long paragraph clamped to two lines. It keeps going so that the clamp has something to cut, and it keeps going a little further still to be sure.</G.Text>
      </State>
      <State label="Superseded, live and skeleton" direction="column">
        <G.Text isSuperseded>Superseded value</G.Text>
        <G.Text live="polite">Saved just now.</G.Text>
        <G.Text isSkeleton>Loading text</G.Text>
      </State>
    </Matrix>
  ),
};

export const TextAction: Story = {
  render: () => (
    <Matrix>
      <State label="Appearances">
        <G.TextAction href="#inline">Inline</G.TextAction>
        <G.TextAction href="#muted" appearance="muted">Muted</G.TextAction>
        <G.TextAction onPress={noop} appearance="choice">Choice</G.TextAction>
        <G.TextAction href="#route" appearance="route">Route</G.TextAction>
        <G.TextAction onPress={noop} appearance="disclosure">Disclosure</G.TextAction>
      </State>
      <State label="Current (selected)">
        <G.TextAction href="#route" appearance="route" isCurrent>Current route</G.TextAction>
        <G.TextAction onPress={noop} appearance="choice" isCurrent>Selected choice</G.TextAction>
      </State>
      <State label="Disabled">
        <G.TextAction onPress={noop} isDisabled>Unavailable</G.TextAction>
      </State>
      <State label="Pending">
        <G.TextAction onPress={noop} isPending>Refreshing</G.TextAction>
      </State>
      <State label="Skeleton">
        <G.TextAction href="#loading" isSkeleton>Loading</G.TextAction>
      </State>
    </Matrix>
  ),
};

export const Link: Story = {
  render: () => (
    <Matrix>
      <State label="Kinds">
        <G.Link href="#internal">Internal link</G.Link>
        <G.Link href="https://example.com" kind="external" externalHint="(opens in a new tab)">External link</G.Link>
      </State>
      <State label="Current">
        <G.Link href="#current" isCurrent>Current page</G.Link>
      </State>
      <State label="Disabled">
        <G.Link href="#disabled" isDisabled>Unavailable link</G.Link>
      </State>
      <State label="Uniform visited styling">
        <G.Link href="#uniform" visited="uniform">Uniform link</G.Link>
      </State>
    </Matrix>
  ),
};

export const Avatar: Story = {
  render: () => (
    <Matrix>
      <State label="Loading (isSkeleton)">
        <G.Avatar name="Alex Morgan" isSkeleton size="sm" />
        <G.Avatar name="Alex Morgan" isSkeleton />
        <G.Avatar name="Alex Morgan" isSkeleton size="lg" />
      </State>
      <State label="Local DiceBear initials by default, and uploaded image">
        <G.Avatar name={"Tr\u1ea7n Minh Khoa"} />
        <G.Avatar name="Sam Lee" src={placeholderImage('S', 200)} />
      </State>
      <State label="Seed controls the background; first and last name words control the letters">
        <G.Avatar name="Alex Morgan" seed="user-alex" />
        <G.Avatar name="Alex after a name change" seed="user-alex" />
        <G.Avatar name="Sam Lee" seed="user-sam" />
      </State>
      <State label="An uploaded src wins over seed">
        <G.Avatar name="Alex Morgan" seed="user-alex" src={placeholderImage('A', 40)} />
      </State>
      <State label="Agents: free names, same initials rule, bottom-right AI bot badge">
        <G.Avatar name={"Th\u1ea3o V\u00e2n Mkt"} kind="agent" seed="agent-1" />
        <G.Avatar name="Cat" kind="agent" seed="agent-2" size="sm" />
        <G.Avatar name="Blue Dog" kind="agent" src={placeholderImage('BD', 290)} size="lg" />
      </State>
      <State label="Sizes">
        <G.Avatar name="Robin Park" size="sm" />
        <G.Avatar name="Robin Park" size="md" />
        <G.Avatar name="Robin Park" size="lg" />
      </State>
      <State label="Current (selected)">
        <G.Avatar name="Jordan Kim" isCurrent />
      </State>
      <State label="Decorative">
        <G.Avatar name="Taylor Fox" seed="user-taylor" isDecorative />
        <G.Text>Taylor Fox</G.Text>
      </State>
    </Matrix>
  ),
};

export const Image: Story = {
  render: () => (
    <Matrix>
      <State label="Aspects">
        <div style={{ width: 200 }}><G.Image src={placeholderImage('Landscape')} alt="Landscape placeholder artwork" aspect="landscape" /></div>
        <div style={{ width: 140 }}><G.Image src={placeholderImage('Square', 160)} alt="Square placeholder artwork" aspect="square" /></div>
        <div style={{ width: 120 }}><G.Image src={placeholderImage('Portrait', 40)} alt="Portrait placeholder artwork" aspect="portrait" fit="contain" /></div>
      </State>
      <State label="Error (invalid source) with fallback">
        <div style={{ width: 200 }}>
          <G.Image src="/missing-story-image.png" alt="Missing artwork" aspect="landscape" fallback={<G.Text tone="muted">Image unavailable</G.Text>} />
        </div>
      </State>
      <State label="Asset slot attributes">
        <div style={{ width: 200 }}><G.Image src={placeholderImage('Slot')} alt="" aspect="landscape" assetSlot="story.card-art" assetSha256="0000" /></div>
      </State>
    </Matrix>
  ),
};

/** One size scale for generated character art: each step one step down below 48rem, the hero absent below 64rem unless kept. */
export const Mascot: Story = {
  render: () => (
    <Matrix>
      <State label="Steps sm, md, lg (decorative)">
        <G.Mascot src={turtleUrl} size="sm" assetSlot="story.mascot-sm" />
        <G.Mascot src={turtleUrl} size="md" assetSlot="story.mascot-md" />
        <G.Mascot src={turtleUrl} size="lg" assetSlot="story.mascot-lg" assetSha256="0000" assetPrompt="A friendly turtle mascot" />
      </State>
      <State label="Meaningful (named by alt)">
        <G.Mascot src={turtleUrl} alt="Todo app turtle mascot" size="md" assetSlot="story.mascot-named" />
      </State>
      <State label="Hero fills its host's height (hidden below 64rem)">
        <div style={{ height: 320, width: 360 }}><G.Mascot src={turtleUrl} size="hero" loading="eager" assetSlot="story.mascot-hero" /></div>
      </State>
      <State label="Hero kept at every width">
        <div style={{ height: 320, width: 360 }}><G.Mascot src={turtleUrl} size="hero" visibility="always" assetSlot="story.mascot-hero-kept" /></div>
      </State>
    </Matrix>
  ),
};

export const Kbd: Story = {
  render: () => (
    <Matrix>
      <State label="Chords">
        <G.Kbd keys={['command', 'K']} />
        <G.Kbd keys={['ctrl', 'shift', 'P']} />
        <G.Kbd keys={['escape']} />
        <G.Kbd keys={['enter']} />
      </State>
    </Matrix>
  ),
};

export const CloseButton: Story = {
  render: () => (
    <Matrix>
      <State label="Sizes">
        <G.CloseButton label="Close" size="sm" onPress={noop} />
        <G.CloseButton label="Close" size="md" onPress={noop} />
      </State>
      <State label="Disabled">
        <G.CloseButton label="Close" isDisabled />
      </State>
    </Matrix>
  ),
};

export const Spinner: Story = {
  render: () => (
    <Matrix>
      <State label="Sizes (pending)">
        <G.Spinner label="Loading" size="sm" />
        <G.Spinner label="Loading" size="md" />
        <G.Spinner label="Loading" size="lg" />
      </State>
      <State label="Current colour">
        <G.Text tone="muted" startContent={<G.Spinner label="Syncing" tone="current" size="sm" />}>Syncing</G.Text>
      </State>
    </Matrix>
  ),
};

export const Skeleton: Story = {
  render: () => (
    <Matrix maxWidth={420}>
      <State label="Text lines" direction="column">
        <G.Skeleton shape="text" lines={3} />
      </State>
      <State label="Rect ratios">
        <div style={{ width: 120 }}><G.Skeleton shape="rect" ratio="square" /></div>
        <div style={{ width: 160 }}><G.Skeleton shape="rect" ratio="landscape" /></div>
        <div style={{ width: 200 }}><G.Skeleton shape="rect" ratio="wide" /></div>
      </State>
      <State label="Circles">
        <G.Skeleton shape="circle" size="sm" />
        <G.Skeleton shape="circle" size="md" />
        <G.Skeleton shape="circle" size="lg" />
      </State>
    </Matrix>
  ),
};

export const Meter: Story = {
  render: () => (
    <Matrix maxWidth={420}>
      <State label="Loading (isSkeleton)" direction="column">
        <G.Meter label="Storage" value={32} isSkeleton />
      </State>
      <State label="Tones" direction="column">
        <G.Meter label="Storage" value={32} tone="neutral" />
        <G.Meter label="Goal" value={80} tone="affirmative" valueLabel="8 of 10 lessons" />
        <G.Meter label="Quota" value={72} tone="cautionary" />
        <G.Meter label="Errors" value={95} tone="negative" />
        <G.Meter label="Sync" value={50} tone="pending" />
      </State>
      <State label="Hidden label" direction="column">
        <G.Meter label="Battery" value={64} isLabelHidden />
      </State>
      <State label="Thin track (size sm)" direction="column">
        <G.Meter label="Storage" value={32} size="sm" />
        <G.Meter label="Errors" value={95} tone="negative" size="sm" valueLabel="95%" />
        <G.Meter label="Storage" value={32} size="sm" isSkeleton />
      </State>
      <State label="Segmented count" direction="column">
        <G.Meter label="Capabilities" value={3} maxValue={3} segments={3} valueLabel="3 of 3" />
        <G.Meter label="Capabilities" value={2} maxValue={3} segments={3} valueLabel="2 of 3" />
        <G.Meter label="Checks passed" value={5} maxValue={8} segments={8} valueLabel="5 of 8" tone="affirmative" />
      </State>
    </Matrix>
  ),
};

export const ConnectionStatus: Story = {
  render: () => (
    <Matrix>
      <State label="Live, reconnecting, lost (polite live regions)">
        <G.ConnectionStatus state="live" label="Live" />
        <G.ConnectionStatus state="reconnecting" label="Reconnecting" />
        <G.ConnectionStatus state="lost" label="Connection lost" />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const states = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="ConnectionStatus"]')];
    await waitFor(() => {
      if (states.length !== 3) throw new Error('Three connection states must render');
      for (const status of states) {
        if (status.getAttribute('role') !== 'status') throw new Error('A connection status is a status region');
        if ((status.textContent ?? '').trim() === '') throw new Error('The words carry the state');
      }
    });
  },
};

export const ProgressCircle: Story = {
  render: () => (
    <Matrix>
      <State label="Determinate">
        <G.ProgressCircle label="Lesson" value={25} size="sm" />
        <G.ProgressCircle label="Lesson" value={60} size="md" />
        <G.ProgressCircle label="Lesson" value={100} size="lg" />
      </State>
      <State label="Indeterminate (pending)">
        <G.ProgressCircle label="Loading" isIndeterminate />
      </State>
    </Matrix>
  ),
};

export const GrammarRoot: Story = {
  render: (_args, { globals }) => {
    const scope = familyScope(globals);
    return (
      <Matrix>
        <State label="Nested explicit themes in the toolbar family (the outer root comes from the toolbar)">
          {(['light', 'dark', 'system'] as const).map((theme) => (
            <G.GrammarRoot key={theme} theme={theme} {...scope} style={{ padding: '1rem', borderRadius: '0.75rem', minWidth: 160 }}>
              <G.Text weight="semibold">{theme} scope</G.Text>
              <G.Text tone="muted" size="sm">Tokens resolve here.</G.Text>
              <div style={{ marginTop: '0.5rem' }}><G.Button size="sm">Action</G.Button></div>
            </G.GrammarRoot>
          ))}
        </State>
      </Matrix>
    );
  },
};

/** A count pinned to the glyph; 0 hides it, numbers above `badgeMax` collapse to `n+`, `badgeLabel` is announced. */
export const IconButtonBadge: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
      <G.IconButton source={BellGlyph} label="Notifications" badge={3} badgeLabel="3 unread" onPress={noop} />
      <G.IconButton source={BellGlyph} label="Notifications" badge={240} badgeLabel="240 unread" onPress={noop} />
      <G.IconButton source={BellGlyph} label="Notifications" variant="ghost" badge="New" badgeLabel="new items" onPress={noop} />
      <G.IconButton source={BellGlyph} label="Notifications" badge={0} badgeLabel="0 unread" onPress={noop} />
    </div>
  ),
};

/** Step mode: one segment per wizard step at the small bar's height; finished and current steps are filled. */
export const ProgressSteps: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1rem', maxWidth: '28rem' }}>
      <G.Progress label="Setup" steps={{ total: 5, completed: 1 }} valueText="Step 1 of 5" />
      <G.Progress label="Setup" steps={{ total: 5, completed: 3 }} valueText="Step 3 of 5" />
      <G.Progress label="Setup" steps={{ total: 5, completed: 5 }} valueText="Step 5 of 5" />
    </div>
  ),
};

/** The one action that must stand out: accent plate, large size, floating elevation (the app positions it). */
export const IconButtonFloating: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', padding: '1rem' }}>
      <G.IconButton source={BellGlyph} label="Ask the assistant" variant="primary" size="lg" isFloating onPress={noop} />
      <G.IconButton source={BellGlyph} label="Ask the assistant" variant="primary" onPress={noop} />
    </div>
  ),
};
