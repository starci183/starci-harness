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
 * Leaves: the elements every family restyles. Each story renders one Common renderer in its
 * relevant states (default, disabled, invalid, pending, selected/current, skeleton) inside the
 * family root chosen in the toolbar.
 */
const meta: Meta = {
  title: 'Leaves',
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
        <G.Badge isLoading>Loading</G.Badge>
      </State>
    </Matrix>
  ),
};

const DOT_TONES = ['neutral', 'accent', 'success', 'warning', 'danger'] as const;

export const StatusDot: Story = {
  render: () => (
    <Matrix>
      <State label="Echo (dot with an expanding ring)">
        {DOT_TONES.map((tone) => <G.StatusDot key={tone} tone={tone} echo aria-label={`Live, ${tone}`} />)}
      </State>
      <State label="Static (dot only)">
        {DOT_TONES.map((tone) => <G.StatusDot key={tone} tone={tone} aria-label={`Status, ${tone}`} />)}
      </State>
      <State label="Badge isDot: the status with its words, beside HeroUI Chip">
        <G.Badge isDot tone="success">online</G.Badge>
        <HeroChip size="sm" color="success" variant="soft">Online</HeroChip>
      </State>
      <State label="Badge isDot isLive: a live feed (polite live region)">
        <G.Badge isDot isLive tone="success">Live</G.Badge>
        <G.Badge isDot isLive tone="warning">Reconnecting</G.Badge>
        <G.Badge isDot tone="danger">Connection lost</G.Badge>
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      for (const dot of canvasElement.querySelectorAll('[data-component="StatusDot"][data-variant="echo"], [data-component="StatusDot"][data-variant="static"]')) {
        if (!dot.getAttribute('aria-label')) throw new Error('A StatusDot needs an aria-label');
      }
      const live = [...canvasElement.querySelectorAll<HTMLElement>('[data-grammar-badge-live="true"]')];
      if (live.length !== 2) throw new Error('Two live badges must render');
      for (const badge of live) {
        if (badge.getAttribute('role') !== 'status') throw new Error('A live badge is a status region');
        if ((badge.textContent ?? '').trim() === '') throw new Error('The words carry the state');
        if (!/^[A-Z]/.test(badge.querySelector('.starci-core-badge-dot-label')?.textContent ?? '')) throw new Error("The label's first letter must be uppercase");
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
        <G.Button intent="commit">Primary</G.Button>
        <G.Button intent="alternative">Secondary</G.Button>
        <G.Button intent="dismiss">Tertiary</G.Button>
        <G.Button intent="neutral">Outline</G.Button>
        <G.Button intent="neutral">Ghost</G.Button>
        <G.Button intent="destructive" step="confirm">Danger</G.Button>
        <G.Button intent="destructive">Danger soft</G.Button>
      </State>
      <State label="Sizes">
        <G.Button size="sm">Small</G.Button>
        <G.Button size="md">Medium</G.Button>
        <G.Button size="lg">Large</G.Button>
      </State>
      <State label="Disabled">
        <G.Button intent="commit" isDisabled>Primary</G.Button>
        <G.Button intent="alternative" isDisabled>Secondary</G.Button>
        <G.Button intent="neutral" isDisabled>Outline</G.Button>
      </State>
      <State label="Pending">
        <G.Button intent="commit" isPending>Saving</G.Button>
        <G.Button intent="alternative" isPending>Loading</G.Button>
      </State>
      <State label="Skeleton">
        <G.Button isLoading>Loading</G.Button>
      </State>
      <State label="With icons, destination and fill width" direction="column">
        <G.Button intent="alternative" startContent={<G.Icon source={SearchGlyph} usage="leading" />}>Search</G.Button>
        <G.Button href="#destination" intent="neutral">Destination link</G.Button>
        <G.Button intent="commit" width="fill">Full width</G.Button>
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
        <G.Heading level={3} isLoading>Loading heading</G.Heading>
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
        <G.Icon source={SearchGlyph} isLoading />
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
      <State label="Dismiss (draws the close glyph itself)">
        <G.IconButton intent="dismiss" label="Close" size="sm" onPress={noop} />
        <G.IconButton intent="dismiss" label="Close" onPress={noop} />
        <G.IconButton intent="dismiss" label="Close" isDisabled />
      </State>
      <State label="Active (selected)">
        <G.IconButton source={BellGlyph} label="Notifications" isActive onPress={noop} />
      </State>
      <State label="Quiet (ghost) - an overflow menu glyph">
        <G.IconButton source={SettingsGlyph} label="More actions" intent="neutral" onPress={noop} />
      </State>
      <State label="Danger-soft - a reversible or row-level delete (an AlertDialog confirm uses the solid danger Button)">
        <G.IconButton source={TrashGlyph} label="Delete row" intent="destructive" onPress={noop} />
        <G.IconButton source={TrashGlyph} label="Delete row unavailable" intent="destructive" isDisabled />
      </State>
      <State label="Disabled">
        <G.IconButton source={SearchGlyph} label="Search unavailable" isDisabled />
      </State>
      <State label="Skeleton">
        <G.IconButton source={SearchGlyph} label="Loading" isLoading />
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
        <G.IconTile source={StarGlyph} isLoading />
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
        <G.Progress label="Loading" isLoading />
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
      </State>
      <State label="Sizes and the strong weight" direction="column">
        <G.Text size="xs">Extra small</G.Text>
        <G.Text size="sm" isStrong>Small strong</G.Text>
        <G.Text size="md" isStrong>Medium strong</G.Text>
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
        <G.Text isLoading>Loading text</G.Text>
      </State>
    </Matrix>
  ),
};

export const TextAction: Story = {
  render: () => (
    <Matrix>
      <State label="Appearances">
        <G.TextAction onPress={noop}>Inline</G.TextAction>
        <G.TextAction onPress={noop} appearance="muted">Muted</G.TextAction>
        <G.TextAction onPress={noop} appearance="choice">Choice</G.TextAction>
        <G.TextAction onPress={noop} appearance="route">Route</G.TextAction>
        <G.TextAction onPress={noop} appearance="disclosure">Disclosure</G.TextAction>
      </State>
      <State label="Current (selected)">
        <G.TextAction onPress={noop} appearance="route" isCurrent>Current route</G.TextAction>
        <G.TextAction onPress={noop} appearance="choice" isCurrent>Selected choice</G.TextAction>
      </State>
      <State label="Disabled">
        <G.TextAction onPress={noop} isDisabled>Unavailable</G.TextAction>
      </State>
      <State label="Pending">
        <G.TextAction onPress={noop} isPending>Refreshing</G.TextAction>
      </State>
      <State label="Skeleton">
        <G.TextAction onPress={noop} isLoading>Loading</G.TextAction>
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
      <State label="Loading (isLoading)">
        <G.Avatar name="Alex Morgan" isLoading size="sm" />
        <G.Avatar name="Alex Morgan" isLoading />
        <G.Avatar name="Alex Morgan" isLoading size="lg" />
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
      <State label="Loading (isLoading)" direction="column">
        <G.Meter label="Storage" value={32} isLoading />
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
        <G.Meter label="Storage" value={32} size="sm" isLoading />
      </State>
      <State label="Segmented count" direction="column">
        <G.Meter label="Capabilities" value={3} maxValue={3} segments={3} valueLabel="3 of 3" />
        <G.Meter label="Capabilities" value={2} maxValue={3} segments={3} valueLabel="2 of 3" />
        <G.Meter label="Checks passed" value={5} maxValue={8} segments={8} valueLabel="5 of 8" tone="affirmative" />
      </State>
    </Matrix>
  ),
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
              <G.Text isStrong>{theme} scope</G.Text>
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
      <G.IconButton source={BellGlyph} label="Notifications" intent="neutral" badge="New" badgeLabel="new items" onPress={noop} />
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
      <G.IconButton source={BellGlyph} label="Ask the assistant" intent="commit" size="lg" isFloating onPress={noop} />
      <G.IconButton source={BellGlyph} label="Ask the assistant" intent="commit" onPress={noop} />
    </div>
  ),
};
