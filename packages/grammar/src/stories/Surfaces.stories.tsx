import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { BookGlyph, Matrix, PlusGlyph, State, familyScope, noop, placeholderImage, rgbaOf, textContrast } from './fixtures.js';
import turtleUrl from './assets/turtle.png';

/**
 * Surfaces: cards, collections, reading frames and scroll regions — the containers every family
 * gives its material treatment (Offset Pop's ink outline and hard offset shadow, …).
 */
const meta: Meta = {
  title: 'Surfaces',
};
export default meta;

type Story = StoryObj;

/**
 * Where the name sits follows the card's kind (ruling card-label-by-kind): a card that heads a section carries its label
 * outside the material, in both families, flush with the card edge; a tile carries its name inside, beside its mark.
 */
export const SurfaceCardLabelByKind: Story = {
  name: 'SurfaceCard label by kind',
  render: () => (
    <div data-story-label-by-kind="true" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '1.5rem', maxWidth: 720 }}>
      <div data-story-kind="section">
        <G.SurfaceCard label="Group info">
          <G.Text>Keep the streak going with one short lesson a day.</G.Text>
        </G.SurfaceCard>
      </div>
      <div data-story-kind="tile">
        <G.SurfaceCard kind="tile" name="Google Drive" mark={{ icon: BookGlyph }} description="Reads the files you share." badge={{ label: 'Connected', tone: 'success', isDot: true }} action={{ label: 'Open', press: noop }} />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const section = canvasElement.querySelector('[data-story-kind="section"] [data-component="SurfaceCard"]');
      const label = section?.querySelector(':scope > [data-grammar-surface-label]');
      const material = section?.querySelector(':scope > [data-grammar-frame="bounded"]');
      expect(label).not.toBeNull();
      expect(material).not.toBeNull();
      // The label row stands above the material, outside it.
      expect(label?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((material?.getBoundingClientRect().top ?? 0) + 0.5);
      const tile = canvasElement.querySelector('[data-story-kind="tile"] [data-component="SurfaceCard"]');
      const name = tile?.querySelector('h3');
      const face = tile?.querySelector(':scope > [data-grammar-frame="bounded"]');
      expect(tile?.querySelector(':scope > [data-grammar-surface-label]')).toBeNull();
      // The name stands inside the material, beside its mark.
      expect(name).not.toBeNull();
      expect(face?.contains(name ?? null)).toBe(true);
    });
  },
};

const dnaPlanOptions = [
  { id: 'starter', label: 'Starter' },
  { id: 'team', label: 'Team' },
];

/** A page with a floating card among other content, holding controls. */
const FloatingCardPage = () => (
  <div data-story-dna-page="true" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0, maxWidth: 640 }}>
    <G.Section title="Weekly review" description="A floating card among other content.">
    <div data-story-dna="floating">
      <G.SurfaceCard label="This week" fact="3 lessons">
        <G.Text>Keep the streak going with one short lesson a day.</G.Text>
        <div data-story-dna="controls" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
          <G.Input id="dna-input" name="name" label="Name" />
          <G.Select label="Plan" options={dnaPlanOptions} defaultValue="team" />
          <G.Button intent="commit" onPress={noop}>Save</G.Button>
        </div>
      </G.SurfaceCard>
    </div>
    </G.Section>
  </div>
);

const rectOf = (element: Element) => element.getBoundingClientRect();
/** A shadow that draws something: any layer left once the transparent zero layers are removed. */
const raised = (element: Element) => /px/.test(getComputedStyle(element).boxShadow.replaceAll(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px,? ?/g, ''));

/** Every DNA rule the page breaks, as readable lines. */
const dnaProblems = (scope: Element): string[] => {
  const problems: string[] = [];
  const card = (slot: string) => scope.querySelector(`[data-story-dna="${slot}"] > [data-component="SurfaceCard"]`);
  const painted = (element: Element) => {
    const style = getComputedStyle(element);
    return style.backgroundColor !== 'rgba(0, 0, 0, 0)' || raised(element) || Number.parseFloat(style.borderTopWidth) > 0;
  };

  const floating = card('floating');
  const label = floating?.querySelector(':scope > [data-grammar-surface-label]') ?? null;
  const material = floating?.querySelector(':scope > [data-grammar-frame="bounded"], :scope > [data-grammar-highlight] > [data-grammar-frame="bounded"]') ?? null;
  if (floating === null || label === null || material === null) problems.push('floating card: label or material missing');
  else {
    if (rectOf(label).bottom > rectOf(material).top + 0.5) problems.push(`floating card: label bottom ${rectOf(label).bottom.toFixed(1)} below material top ${rectOf(material).top.toFixed(1)}`);
    if (painted(floating)) problems.push('floating card: the root around the label is painted');
    if (!painted(material)) problems.push('floating card: the material box is not painted');
  }

  const controls = scope.querySelector('[data-story-dna="controls"]');
  for (const [name, selector] of [['Input', '[data-grammar-input-control="true"]'], ['Select', '[data-component="Select"] button'], ['Button', '[data-component="Button"]']] as const) {
    const control = controls?.querySelector(selector);
    if (control == null) problems.push(`${name}: missing`);
    else if (Math.abs(rectOf(control).height - 40) > 0.5) problems.push(`${name}: block size ${rectOf(control).height.toFixed(1)}px (40px)`);
  }
  return problems;
};

/**
 * The family DNA on one page, light and dark: a floating card (label above the material, the page's commonest card)
 * and the 40px controls (Input, Select, Button) inside it.
 */
export const FloatingCard: Story = {
  parameters: { grammar: { bleed: false } },
  render: (_, { globals }) => (
    <Matrix>
      {(['light', 'dark'] as const).map((theme) => (
        <G.GrammarRoot key={theme} {...familyScope(globals)} theme={theme} data-story-dna-theme={theme} style={{ padding: '1.5rem', background: 'var(--background, Canvas)' }}>
          <FloatingCardPage />
        </G.GrammarRoot>
      ))}
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const problems = [...canvasElement.querySelectorAll('[data-story-dna-theme]')].flatMap((root) =>
        dnaProblems(root).map((problem) => `${root.getAttribute('data-story-dna-theme')}: ${problem}`));
      expect(problems, problems.join('; ')).toEqual([]);
    });
  },
};


export const SurfaceCard: Story = {
  render: () => (
    <Matrix maxWidth={640}>
      <State label="Labelled with a fact" direction="column">
        <G.SurfaceCard label="This week" fact="3 lessons">
          <G.Text>Keep the streak going with one short lesson a day.</G.Text>
        </G.SurfaceCard>
      </State>
      <State label="Whole-card action (link) and highlight (selected)" direction="column">
        <G.SurfaceCard ariaLabel="Grammar basics" wholeAction={{ kind: 'link', href: '#course', label: 'Open Grammar basics' }}>
          <G.Heading level={3}>Grammar basics</G.Heading>
          <G.Text tone="muted">12 lessons</G.Text>
        </G.SurfaceCard>
        <G.SurfaceCard label="Recommended" isHighlight>
          <G.Text>Highlighted surface.</G.Text>
        </G.SurfaceCard>
      </State>
      <State label="States" direction="column">
        <G.SurfaceCard label="Pending" state="pending"><G.Text>Syncing…</G.Text></G.SurfaceCard>
        <G.SurfaceCard label="Unavailable (disabled)" state="unavailable"><G.Text>Not included in your plan.</G.Text></G.SurfaceCard>
        <G.SurfaceCard label="Negative (invalid)" state="negative"><G.Text>The import failed.</G.Text></G.SurfaceCard>
      </State>
      <State label="Ink band with artwork and orbit motif" direction="column">
        <G.SurfaceCard
          ariaLabel="Workspace overview"
          treatment="ink"
          motif="orbit"
          artwork={<G.Image src={placeholderImage('Art', 20)} alt="" fit="contain" loading="eager" assetSlot="story.overview-art" />}
        >
          <G.Text isStrong>Workspace Support</G.Text>
          <G.Text tone="muted">Owner Alex Morgan · Team plan</G.Text>
        </G.SurfaceCard>
        <G.SurfaceCard ariaLabel="Ink band, motif only" treatment="ink" motif="orbit">
          <G.Text isStrong>Motif without artwork</G.Text>
          <G.Text tone="muted">The orbit stays in the artwork zone, never behind the copy.</G.Text>
        </G.SurfaceCard>
      </State>
    </Matrix>
  ),
};

/**
 * The soft treatment: the brand's light tint (`--accent-soft`) as the card's ground under the default foreground,
 * with its artwork slot (here the mascot of a first-run welcome) and real copy and controls. Every text the card
 * draws, muted and accent text included, clears `contrast.text` on the tint in light and dark.
 */
export const SoftSurfaceCard: Story = {
  render: (_, { globals }) => (
    <Matrix maxWidth={720}>
      {(['light', 'dark'] as const).map((theme) => (
        <G.GrammarRoot key={theme} {...familyScope(globals)} theme={theme} data-story-soft-theme={theme} style={{ padding: '1.5rem', background: 'var(--background, Canvas)' }}>
          <State label={`${theme}: soft with artwork (first-run welcome)`} direction="column">
            <G.SurfaceCard
              label="Welcome"
              treatment="soft"
              artwork={<G.Mascot src={turtleUrl} size="md" loading="eager" assetSlot="story.welcome-mascot" />}
            >
              <G.Text isStrong>Set up your workspace</G.Text>
              <G.Text tone="muted">Three short steps, about two minutes.</G.Text>
              <G.Text tone="muted">You can change everything later in settings.</G.Text>
              <G.Text isStrong>Step 1 of 3</G.Text>
              <G.Button intent="commit">Start setup</G.Button>
            </G.SurfaceCard>
          </State>
        </G.GrammarRoot>
      ))}
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const cards = [...canvasElement.querySelectorAll('[data-story-soft-theme] [data-component="SurfaceCard"] > [data-grammar-surface-treatment="soft"]')];
      expect(cards).toHaveLength(2);
      for (const card of cards) {
        expect(card.querySelector(':scope > [data-grammar-surface-artwork="art"] [data-component="Mascot"]')).toHaveAttribute('data-asset-slot', 'story.welcome-mascot');
        // Read without touching the DOM: waitFor re-runs on every mutation, so a probe element would loop.
        const tint = getComputedStyle(card.parentElement ?? card).getPropertyValue('--accent-soft');
        expect(rgbaOf(getComputedStyle(card).backgroundColor)).toEqual(rgbaOf(tint));
      }
      // Every element that draws a text node of its own (eyebrow, title, description, muted and accent lines); the
      // commit Button is the accent fill's own pair and is judged by the button laws.
      const texts = [...canvasElement.querySelectorAll('[data-story-soft-theme] [data-grammar-surface-treatment="soft"] [data-grammar-surface-content] *')]
        .filter((element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== ''))
        .filter((element) => element.closest('[data-component="Button"]') === null);
      expect(texts.length).toBeGreaterThanOrEqual(2 * 5);
      const unreadable = texts
        .map((text) => ({ text: text.textContent, ratio: textContrast(text) }))
        .filter(({ ratio }) => ratio < 4.5)
        .map(({ text, ratio }) => `"${text}" ${ratio}:1`);
      if (unreadable.length > 0) throw new Error(`text below 4.5:1 on the soft ground: ${unreadable.join('; ')}`);
    });
  },
};

/**
 * The accent corner (ruling accent-corner): one logical corner of a card's face or a media viewport at the Common
 * accent radius `--grammar-accent-corner`, the others at the family's surface radius.
 */
export const AccentCorner: Story = {
  render: (_, { globals }) => (
    <Matrix maxWidth={720}>
      <G.GrammarRoot {...familyScope(globals)} data-story-accent-corner="true" style={{ padding: '1.5rem' }}>
        <State label="soft card, accentCorner end-end" direction="column">
          <G.SurfaceCard label="Sign in" treatment="soft" accentCorner="end-end">
            <G.Text>One corner carries the brand's signature radius.</G.Text>
          </G.SurfaceCard>
        </State>
        <State label="media frame, accentCorner start-end" direction="column">
          <G.MediaFrame accentCorner="start-end" assetSlot="story.accent-corner" aspect="square" media={<img alt="" src={turtleUrl} />} />
        </State>
      </G.GrammarRoot>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const root = canvasElement.querySelector('[data-story-accent-corner]');
      if (root === null) throw new Error('no story root');
      const accent = getComputedStyle(root).getPropertyValue('--grammar-accent-corner').trim();
      expect(accent).toBe('2.5rem');
      const px = `${parseFloat(accent) * parseFloat(getComputedStyle(document.documentElement).fontSize)}px`;
      const face = root.querySelector('[data-component="SurfaceCard"] [data-grammar-accent-corner="end-end"]');
      const viewport = root.querySelector('[data-component="MediaFrame"] [data-grammar-accent-corner="start-end"]');
      if (face === null || viewport === null) throw new Error('accent corner not stamped');
      expect(getComputedStyle(face).borderEndEndRadius).toBe(px);
      expect(getComputedStyle(face).borderStartStartRadius).not.toBe(px);
      expect(getComputedStyle(viewport).borderStartEndRadius).toBe(px);
      expect(getComputedStyle(viewport).borderEndEndRadius).not.toBe(px);
    });
  },
};

/**
 * Freestyle (ruling grammar-freestyle-region): the sanctioned escape hatch. It fills its host, adds no paint of its own,
 * stamps its reason, and the app's own divs and CSS inside it are the app's.
 */
export const Freestyle: Story = {
  render: () => (
    <div data-story-freestyle="true" style={{ blockSize: '16rem', inlineSize: '28rem' }}>
      <G.Freestyle reason="story: hand-placed art">
        <div style={{ position: 'relative', blockSize: '100%', borderRadius: '1.25rem', background: 'linear-gradient(135deg, #fde68a, #f9a8d4)' }}>
          <div style={{ position: 'absolute', insetBlockStart: '1rem', insetInlineEnd: '1rem', inlineSize: '5.5rem', blockSize: '5.5rem', borderRadius: '9999px', background: '#ffffffaa' }} />
        </div>
      </G.Freestyle>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const host = canvasElement.querySelector('[data-story-freestyle]');
      const region = host?.querySelector('[data-component="Freestyle"]');
      if (!(host instanceof HTMLElement) || !(region instanceof HTMLElement)) throw new Error('the freestyle region renders');
      expect(region.getAttribute('data-grammar-freestyle-reason')).toBe('story: hand-placed art');
      const style = getComputedStyle(region);
      // It fills its host and adds no paint of its own.
      expect(Math.abs(region.getBoundingClientRect().height - host.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
      expect(Math.abs(region.getBoundingClientRect().width - host.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
      expect(rgbaOf(style.backgroundColor)[3]).toBe(0);
      expect(style.boxShadow).toBe('none');
      expect(style.borderTopWidth).toBe('0px');
      expect(style.borderStartStartRadius).toBe('0px');
      expect(style.paddingTop).toBe('0px');
    });
  },
};

const checkRows: readonly G.ListRowData[] = [
  { id: 'a', title: 'Email verified', state: 'affirmative' },
  { id: 'b', title: 'Payment method', description: 'Expires soon', state: 'cautionary' },
  { id: 'c', title: 'Two-factor', state: 'negative' },
  { id: 'd', title: 'Backup', state: 'pending' },
];

/** `kind="list"`: rows as data, drawn by one row; the list answers for its empty and loading states. */
export const SurfaceCardList: Story = {
  name: 'SurfaceCard kind list',
  render: () => (
    <Matrix maxWidth={640}>
      <State label="Rows with states, a fact and a note" direction="column">
        <G.SurfaceCard kind="list" label="Checks" fact="4 items" note={<G.Text tone="muted" size="sm">Updated just now.</G.Text>} items={checkRows} empty={<G.EmptyNotice message="Nothing to check." />} />
      </State>
      <State label="Verdict collection (a row reports a direction)" direction="column">
        <G.SurfaceCard
          kind="list"
          label="Movement"
          items={[{ id: 'up', title: 'Ada', verdict: 'success' }, { id: 'down', title: 'Grace', verdict: 'danger' }]}
          empty={<G.EmptyNotice message="No movement." />}
        />
      </State>
      <State label="Loading (3 skeleton rows by default)" direction="column">
        <G.SurfaceCard kind="list" label="Saved lessons" isLoading items={[]} empty={<G.EmptyNotice message="Nothing saved yet." />} />
      </State>
      <State label="Loading (the rows it was given, as geometry)" direction="column">
        <G.SurfaceCard kind="list" label="Saved lessons" isLoading items={checkRows} empty={<G.EmptyNotice message="Nothing saved yet." />} />
      </State>
      <State label="Empty (a notice, not a list)" direction="column">
        <G.SurfaceCard kind="list" label="Saved" items={[]} empty={<G.EmptyNotice message="Nothing saved yet." description="Saved lessons appear here." />} />
      </State>
    </Matrix>
  ),
};

/** The row anatomy: leading mark, title with badges, one line, one visible command, a menu, a detail region. */
export const SurfaceCardListRow: Story = {
  name: 'SurfaceCard list row',
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Several accounts of one provider" direction="column">
        <G.SurfaceCard
          kind="list"
          label="Bank feed"
          fact="3 accounts"
          labelEnd={<G.Button intent="neutral" onPress={noop}>Add</G.Button>}
          empty={<G.EmptyNotice message="No accounts." />}
          items={[
            {
              id: 'main',
              leading: { icon: BookGlyph },
              title: 'Main account',
              badges: [{ label: 'Connected', tone: 'success', isDot: true }, { label: 'Test' }],
              description: 'Bank A · •••• 4321 · Holder name · Used by: Accounting',
              menu: { label: 'Options for Main account', entries: [{ id: 'rename', label: 'Rename' }] },
            },
            {
              id: 'second',
              leading: { icon: BookGlyph },
              title: 'Second account',
              badges: [{ label: 'Unfinished', tone: 'warning', isDot: true }],
              description: 'Bank A · •••• 1234 · Holder name',
              action: { label: 'Continue', intent: 'alternative', press: noop },
              menu: { label: 'Options for Second account', entries: [{ id: 'rename', label: 'Rename' }] },
              state: 'cautionary',
            },
            {
              id: 'old',
              leading: { icon: BookGlyph },
              title: 'Old account',
              badges: [{ label: 'Needs attention', tone: 'danger', isDot: true }],
              description: 'Bank B · •••• 9876',
              menu: { label: 'Options for Old account', entries: [{ id: 'rename', label: 'Rename' }] },
              state: 'negative',
              detail: <G.Alert tone="negative" title="The provider rejected the last delivery" description="Check the key on the provider, then send a test." />,
            },
          ]}
        />
      </State>
      <State label="Avatars, positions and a destination" direction="column">
        <G.SurfaceCard
          kind="list"
          label="Seats"
          empty={<G.EmptyNotice message="No seats." />}
          items={[
            { id: 'a', leading: { avatar: { name: 'Alex Morgan', kind: 'person' } }, title: 'Alex Morgan', description: 'Owner', action: { label: 'Open', href: '#alex' } },
            { id: 'b', leading: { position: 2 }, title: 'Second step', description: 'Runs after the first' },
          ]}
        />
      </State>
    </Matrix>
  ),
};

const ListTitleDestinationDemo = () => {
  const [followed, setFollowed] = useState(0);
  const rows: readonly G.ListRowData[] = [{
    id: 'review', title: 'Review the delivery request', description: 'A pending request with a native title destination.',
    href: '#delivery-request', onFollow: () => setFollowed((count) => count + 1),
    action: { label: 'Dismiss', press: noop },
  }];
  return (
    <Matrix maxWidth={640}>
      <State label="Title navigation and a separate command" direction="column">
        <G.SurfaceCard kind="list" label="Pending requests" items={rows} empty={<G.EmptyNotice message="Nothing waiting" />} />
        <G.Text>{`Follow callbacks: ${followed}`}</G.Text>
      </State>
      <State label="Loading removes the title destination" direction="column">
        <G.SurfaceCard kind="list" label="Pending requests" isLoading items={rows} empty={<G.EmptyNotice message="Nothing waiting" />} />
      </State>
    </Matrix>
  );
};

/** A row links its text title; following it reports navigation without enclosing sibling commands. */
export const ListTitleDestination: Story = {
  render: () => <ListTitleDestinationDemo />,
  play: async ({ canvasElement }) => {
    const scope = canvasElement;
    const link = scope.querySelector<HTMLAnchorElement>('a[href="#delivery-request"]');
    if (link === null) throw new Error('The row title is not a native destination');
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(link.querySelector('button')).toBeNull();
    expect(link.closest('[data-component="ListRow"]')?.querySelector('[data-component="Button"]')).not.toBeNull();
    link.click();
    await waitFor(() => expect(scope.textContent).toContain('Follow callbacks: 1'));
    expect(scope.querySelector('[data-component="ListRow"][data-grammar-skeleton="true"] a')).toBeNull();
  },
};

const BusyItemActionDemo = () => {
  const [activations, setActivations] = useState(0);
  const activate = () => setActivations((count) => count + 1);
  return (
    <Matrix maxWidth={640}>
      <State label="Busy row commands and destinations keep their labels" direction="column">
        <G.SurfaceCard kind="list" label="Providers" empty={<G.EmptyNotice message="No providers" />}
          items={[
            { id: 'install', title: 'Storage provider', action: { label: 'Installing', press: activate, isPending: true } },
            { id: 'open', title: 'Messaging provider', action: { label: 'Opening', href: '#provider', isPending: true } },
          ]} />
      </State>
      <State label="Busy tile action is pending rather than a skeleton" direction="column">
        <G.SurfaceCard kind="tile" name="Calendar provider" mark={{ icon: PlusGlyph }}
          description="Keep events in sync" action={{ label: 'Installing', press: activate, isPending: true }} />
      </State>
      <G.Text>{`Action activations: ${activations}`}</G.Text>
    </Matrix>
  );
};

/** ItemAction forwards the Button's action-owned pending state in both row and tile renderers. */
export const BusyItemAction: Story = {
  render: () => <BusyItemActionDemo />,
  play: ({ canvasElement }) => {
    const scope = canvasElement;
    const pending = scope.querySelectorAll<HTMLElement>('[data-action-pending="true"]');
    expect(pending.length).toBe(3);
    for (const action of pending) {
      expect(action.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(action.getAttribute('href')).toBeNull();
      action.click();
    }
    expect(scope.textContent).toContain('Action activations: 0');
  },
};

const FigureDestinationsDemo = () => {
  const [followed, setFollowed] = useState(0);
  const figures: readonly G.Figure[] = [
    { id: 'pending', term: 'Pending approvals', value: 3, meta: 'Needs attention', href: '#approvals', onFollow: () => setFollowed((count) => count + 1) },
    { id: 'completed', term: 'Completed', value: 8 },
    { id: 'unavailable', term: 'Archived requests', value: 2, href: '#archive', isDisabled: true },
    { id: 'coverage', term: 'Coverage', value: 97, unit: '%', href: '#coverage' },
  ];
  return (
    <Matrix maxWidth={960}>
      <State label="Whole figure cells navigate; their values stay neutral" direction="column">
        <G.SurfaceCard kind="figures" label="Operations" items={figures} />
        <G.Text>{`Figure follow callbacks: ${followed}`}</G.Text>
      </State>
      <State label="Loading figures open nothing" direction="column">
        <G.SurfaceCard kind="figures" label="Loading operations" items={figures} isLoading />
      </State>
      <State label="A pending card opens nothing" direction="column">
        <G.SurfaceCard kind="figures" label="Pending operations" items={figures} state="pending" />
      </State>
    </Matrix>
  );
};

/** Native cell destinations share the root router without changing the metric's text treatment. */
export const FigureDestinations: Story = {
  render: () => <FigureDestinationsDemo />,
  play: async ({ canvasElement }) => {
    const scope = canvasElement;
    const links = scope.querySelectorAll<HTMLAnchorElement>('[data-grammar-figure-link="true"]');
    expect(links.length).toBe(2);
    const link = scope.querySelector<HTMLAnchorElement>('a[href="#approvals"]');
    if (link === null) throw new Error('The whole figure cell has no destination');
    expect(link.getAttribute('aria-label')).toBe('Pending approvals: 3');
    link.focus();
    expect(document.activeElement).toBe(link);
    link.click();
    await waitFor(() => expect(scope.textContent).toContain('Figure follow callbacks: 1'));
    expect(scope.querySelector('a[href="#archive"]')).toBeNull();
    expect(scope.querySelector('[data-grammar-state="pending"] [data-grammar-figure-link="true"]')).toBeNull();
    expect(scope.querySelector('[data-loading="true"] [data-grammar-figure-link="true"]')).toBeNull();
  },
};

const AccordionCardDemo = () => {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(['week-1']));
  const weeks = [
    { id: 'week-1', title: 'Week 1', meta: '3 lessons', body: 'Articles, plurals and pronouns.' },
    { id: 'week-2', title: 'Week 2', meta: '4 lessons', body: 'Present tenses.' },
    { id: 'week-3', title: 'Week 3', meta: 'Locked', body: 'Past tenses.', isDisabled: true },
  ];
  return (
    <G.SurfaceCard
      kind="accordion"
      label="Course outline"
      items={weeks.map((week) => ({
        id: week.id,
        title: week.title,
        meta: week.meta,
        body: <G.Text>{week.body}</G.Text>,
        isOpen: open.has(week.id),
        isDisabled: week.isDisabled === true,
      }))}
      onItemOpenChange={(id, isOpen) =>
        setOpen((current) => {
          const next = new Set(current);
          if (isOpen) next.add(id);
          else next.delete(id);
          return next;
        })
      }
    />
  );
};

const SingleAccordionDemo = () => {
  const [isOpen, setOpen] = useState(false);
  return (
    <G.SurfaceCard
      kind="accordion"
      ariaLabel="Refund policy"
      items={[{ id: 'refund', title: 'Refund policy', body: <G.Text>Refunds are available within 14 days.</G.Text>, isOpen }]}
      onItemOpenChange={(_id, next) => setOpen(next)}
    />
  );
};

export const SurfaceCardAccordion: Story = {
  name: 'SurfaceCard kind accordion',
  render: () => (
    <Matrix maxWidth={640}>
      <State label="Rows: one open (selected), one disabled" direction="column"><AccordionCardDemo /></State>
      <State label="Single item, collapsed" direction="column"><SingleAccordionDemo /></State>
      <State label="Loading" direction="column">
        <G.SurfaceCard kind="accordion" label="Course outline" isLoading onItemOpenChange={noop} items={[{ id: 'w1', title: 'Week 1', meta: '3 lessons', body: 'x', isOpen: false }, { id: 'w2', title: 'Week 2', meta: '4 lessons', body: 'x', isOpen: false }]} />
      </State>
    </Matrix>
  ),
};

const stripFigures: readonly G.Figure[] = [
  { id: 'runtime', icon: BookGlyph, term: 'Runtime', value: 'Provisioned', meta: 'Verified 10:00' },
  { id: 'installs', icon: BookGlyph, term: 'Installations', value: 2, unit: 'modules', meta: 'Inventoried 10:00' },
  { id: 'capabilities', icon: BookGlyph, term: 'Capabilities on', value: '5/6', meta: '1 capability off' },
  { id: 'conversations', icon: BookGlyph, term: 'Conversations · 7 days', value: '1,596', unit: 'conversations', meta: 'Across 2 modules' },
];

/** `kind="figures"`: two to four key figures as touching cells, divided by lines; the card holds nothing else. */
export const SurfaceCardFigures: Story = {
  name: 'SurfaceCard kind figures',
  render: () => (
    <Matrix maxWidth={960}>
      <State label="Four figures with a label" direction="column">
        <G.SurfaceCard kind="figures" label="Usage" items={stripFigures} />
      </State>
      <State label="Three figures, unlabelled (an odd last cell spans its row when narrow)" direction="column">
        <G.SurfaceCard kind="figures" ariaLabel="Usage" items={stripFigures.slice(0, 3)} />
      </State>
      {([
        ['Narrow: 2 x 2 from 18rem of its own width', 400, stripFigures],
        ['Narrow: one column', 240, stripFigures],
        ['Narrow, odd last cell: 2 + 1', 400, stripFigures.slice(0, 3)],
      ] as const).map(([label, width, items]) => (
        <State key={label} label={label} direction="column">
          <div style={{ width, maxWidth: '100%' }}>
            <G.SurfaceCard kind="figures" ariaLabel={label} items={items} />
          </div>
        </State>
      ))}
      <State label="Loading" direction="column">
        <G.SurfaceCard kind="figures" label="Usage, loading" isLoading items={stripFigures} />
      </State>
    </Matrix>
  ),
};

/** Header zones above a list: a custom face and a figures strip, divided by the seams the shell draws. */
export const SurfaceCardZoneFaces: Story = {
  name: 'SurfaceCard header zones',
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Body, figures, then a list" direction="column">
        <G.SurfaceCard
          kind="list"
          label="Workspace"
          headers={[
            { kind: 'custom', children: <G.Text>Support runs on the Team plan, owned by Alex Morgan.</G.Text> },
            { kind: 'figures', items: stripFigures.slice(0, 3) },
          ]}
          items={checkRows.slice(0, 2)}
          empty={<G.EmptyNotice message="Nothing to check." />}
        />
      </State>
      <State label="A custom picture zone, then a body" direction="column">
        <G.SurfaceCard
          label="Launch"
          headers={[
            { kind: 'custom', children: <G.Image src={placeholderImage('Launch', 20)} alt="Launch artwork" aspect="wide" loading="eager" assetSlot="story.zone-media" /> },
          ]}
        >
          <G.Text>A custom header zone holds one picture; the body below is padded by the card.</G.Text>
        </G.SurfaceCard>
      </State>
    </Matrix>
  ),
};

/** `kind="tile"`: a peer you recognise and open. The name sits inside, beside its mark; status and action are at the bottom. */
export const SurfaceCardTile: Story = {
  name: 'SurfaceCard kind tile',
  render: () => (
    <Matrix maxWidth={960}>
      <State label="A grid of tiles: icon, logo and avatar marks; a status; an action or a whole-card link" direction="column">
        <G.Grid kind="cards">
          <G.SurfaceCard kind="tile" name="Google Drive" mark={{ icon: BookGlyph }} description="Reads the files you share with the agent." badge={{ label: 'Connected', tone: 'success', isDot: true }} action={{ label: 'Open', press: noop }} />
          <G.SurfaceCard kind="tile" name="SePay" mark={{ logo: { src: placeholderImage('Pay', 40), alt: '' } }} description="Matches incoming payments." badge={{ label: 'Not set up', tone: 'muted', isDot: true }} action={{ label: 'Set up', press: noop }} />
          <G.SurfaceCard kind="tile" name="Zalo OA" mark={{ avatar: { name: 'Zalo OA', kind: 'agent' } }} description="Answers customers on Zalo." wholeAction={{ kind: 'link', href: '#zalo', label: 'Open Zalo OA' }} />
        </G.Grid>
      </State>
      <State label="Loading" direction="column">
        <G.Grid kind="cards">
          <G.SurfaceCard kind="tile" isLoading name="Google Drive" mark={{ icon: BookGlyph }} description="Reads the files you share with the agent." badge={{ label: 'Connected', tone: 'success' }} action={{ label: 'Open', press: noop }} />
        </G.Grid>
      </State>
    </Matrix>
  ),
};


export const EmptyNotice: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="Message only" direction="column">
        <G.EmptyNotice message="No lessons yet." />
      </State>
      <State label="With icon and action" direction="column">
        <G.EmptyNotice message="No saved lessons." description="Save a lesson to find it here." iconSource={BookGlyph} actionLabel="Browse lessons" actionStartContent={<G.Icon source={PlusGlyph} usage="leading" />} onAction={noop} />
      </State>
      <State label="Action pending" direction="column">
        <G.EmptyNotice message="Nothing to import." actionLabel="Refresh" isActionPending onAction={noop} />
      </State>
      <State label="First run (artwork: the mascot at md, tied to its asset slot)" direction="column">
        <div data-story-empty="first-run">
          <G.EmptyNotice
            message="Your workspace is ready."
            description="Add your first channel to start receiving conversations."
            artwork={{ src: turtleUrl, loading: 'eager', assetSlot: 'story.first-run-mascot' }}
            actionLabel="Add a channel"
            onAction={noop}
          />
        </div>
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const notice = canvasElement.querySelector('[data-story-empty="first-run"] [data-component="EmptyNotice"]');
      expect(notice).toHaveAttribute('data-grammar-empty-mark', 'artwork');
      const mascot = notice?.querySelector(':scope > [data-component="Mascot"]');
      expect(mascot).toHaveAttribute('data-grammar-mascot-size', 'md');
      expect(mascot).toHaveAttribute('data-asset-slot', 'story.first-run-mascot');
      expect(mascot).toHaveAttribute('aria-hidden', 'true');
      expect(notice?.querySelectorAll('[data-component="Button"]')).toHaveLength(1);
    });
  },
};

export const Section: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Region with count, trailing source meta and one page command" direction="column">
        <G.Section title="Installations" count={2} meta="Inventoried at 10:00, 26 Sep 2026 (GMT+7)" description="Twelve short lessons." action={<G.Button intent="alternative" size="sm">Share</G.Button>}>
          <G.SurfaceCard label="Grammar basics" headingLevel={3}><G.Text>Everything the course covers.</G.Text></G.SurfaceCard>
        </G.Section>
      </State>
      <State label="Long list with a filter row: Section of rows, section spacing" direction="column">
        <G.Section
          kind="list"
          title="Customers"
          count={4}
          filter={<G.FilterButtonGroup label="Plan" options={[{ value: "all", label: "All" }, { value: "team", label: "Team" }, { value: "solo", label: "Solo" }]} defaultValue="all" />}
          items={[
            { id: "ada", title: "Ada Lovelace", description: "Team plan", badges: [{ label: "Active", tone: "success" }], action: { label: "Open", press: noop } },
            { id: "grace", title: "Grace Hopper", description: "Solo plan" },
            { id: "alan", title: "Alan Turing", description: "Team plan", badges: [{ label: "Overdue", tone: "warning" }] },
            { id: "edsger", title: "Edsger Dijkstra", description: "Solo plan", detail: <G.Alert tone="negative" title="Card expired" description="Ask for a new one." /> },
          ]}
          empty={<G.EmptyNotice message="No customers match." />}
        />
      </State>
      <State label="Ordered list" direction="column">
        <G.Section
          kind="list"
          title="Setup"
          headingLevel={3}
          items={[
            { id: "one", leading: { position: 1 }, title: "Connect a provider" },
            { id: "two", leading: { position: 2 }, title: "Invite the team", description: "They get an email." },
          ]}
          empty={<G.EmptyNotice message="Nothing to do." />}
        />
      </State>
      <State label="Empty list" direction="column">
        <G.Section kind="list" title="Customers" items={[]} empty={<G.EmptyNotice message="No customers yet." />} />
      </State>
      <State label="Loading (isLoading)" direction="column">
        <G.Section kind="list" title="Customers" description="Everyone on a plan." meta="Updated now" action={<G.Button intent="alternative" size="sm">Share</G.Button>} items={[]} empty={null} isLoading />
      </State>
    </Matrix>
  ),
};

export const MediaFrame: Story = {
  render: () => (
    <Matrix maxWidth={640}>
      <State label="Framed with caption">
        <div style={{ width: 320 }}>
          <G.MediaFrame caption="Figure 1. Placeholder artwork." media={<img src={placeholderImage('Framed')} alt="Placeholder artwork" />} />
        </div>
      </State>
      <State label="Plain, square, contain">
        <div style={{ width: 200 }}>
          <G.MediaFrame treatment="plain" aspect="square" fit="contain" media={<img src={placeholderImage('Plain', 160)} alt="Plain placeholder artwork" />} />
        </div>
      </State>
      <State label="Asset slot (data-asset-slot / -sha256 / -prompt)">
        <div style={{ width: 200 }}>
          <G.MediaFrame treatment="plain" assetSlot="story.hero" assetSha256="0000" assetPrompt="Placeholder until interface.asset delivers the art" media={<img src={placeholderImage('Slot', 200)} alt="" />} />
        </div>
      </State>
    </Matrix>
  ),
};

export const MarkdownArticle: Story = {
  render: () => (
    <G.MarkdownArticle ariaLabel="Lesson article">
      <h1>Articles in English</h1>
      <p>Use <strong>a</strong> before consonant sounds and <strong>an</strong> before vowel sounds.</p>
      <h2>Examples</h2>
      <ul>
        <li>a book</li>
        <li>an hour</li>
      </ul>
      <blockquote>Sound, not spelling, decides.</blockquote>
      <p>Inline <code>code</code> and a <a href="#reference">reference link</a>.</p>
    </G.MarkdownArticle>
  ),
};

export const FencedCodeBlock: Story = {
  render: () => (
    <Matrix maxWidth={640}>
      <State label="Authored code with language and action" direction="column">
        <G.FencedCodeBlock language="tsx" code={'import { CoreGrammarRoot } from "../common/index.js"\n\nexport const App = () => <CoreGrammarRoot>…</CoreGrammarRoot>'} action={<G.Button size="sm" intent="neutral">Copy</G.Button>} />
      </State>
      <State label="Rendered children" direction="column">
        <G.FencedCodeBlock language="sh"><code>npm install @starci/grammar</code></G.FencedCodeBlock>
      </State>
    </Matrix>
  ),
};

export const MarkdownTableFrame: Story = {
  render: () => (
    <G.MarkdownTableFrame>
      <table>
        <caption>Article choice</caption>
        <thead>
          <tr><th scope="col">Word</th><th scope="col">Article</th><th scope="col">Why</th></tr>
        </thead>
        <tbody>
          <tr><td>hour</td><td>an</td><td>Silent h</td></tr>
          <tr><td>university</td><td>a</td><td>Starts with a y sound</td></tr>
        </tbody>
      </table>
    </G.MarkdownTableFrame>
  ),
};

export const HorizontalScrollRegion: Story = {
  render: () => (
    <Matrix maxWidth={520}>
      <State label="Overflow needed (focusable scroll region)" direction="column">
        <G.HorizontalScrollRegion aria-label="Lesson cards" tabIndex={0}>
          <div style={{ display: 'flex', gap: '0.75rem', width: 'max-content' }}>
            {Array.from({ length: 8 }, (_, index) => (
              <G.SurfaceCard key={index} ariaLabel={`Lesson ${index + 1}`}><G.Text>Lesson {index + 1}</G.Text></G.SurfaceCard>
            ))}
          </div>
        </G.HorizontalScrollRegion>
      </State>
    </Matrix>
  ),
};

export const VerticalScrollRegion: Story = {
  render: () => (
    <Matrix maxWidth={420}>
      <State label="Contained scroll" direction="column">
        <div style={{ height: 180, display: 'flex' }}>
          <G.VerticalScrollRegion isScrollable aria-label="Activity" tabIndex={0}>
            {Array.from({ length: 12 }, (_, index) => (
              <G.Text key={index}>Activity item {index + 1}</G.Text>
            ))}
          </G.VerticalScrollRegion>
        </div>
      </State>
    </Matrix>
  ),
};


/** Two sources disagree on one fact: the question is the section's title, each quote names its source, the answers are a decision group. */
export const Contradiction: Story = {
  render: () => (
    <div style={{ maxWidth: '48rem' }}>
      <G.Section title="Is the starting capital 300 or 285 million?" description="Two sources give a different figure.">
        <G.Stack gap="row">
          <G.Cluster gap="row">
            <G.Quote source="Contract" byline="Page 2, signed 4 March" text={'The founders contribute a starting capital of 300 million.'} />
            <G.Quote source="Chat" byline="Zalo, 09:12" text={'We transferred 285 million, the rest comes after the licence.'} />
          </G.Cluster>
          <G.Cluster gap="inline" justify="end">
            <G.Button intent="dismiss" onPress={noop}>Ask later</G.Button>
            <G.Button intent="alternative" onPress={noop}>It is 285 million</G.Button>
            <G.Button intent="commit" onPress={noop}>It is 300 million</G.Button>
          </G.Cluster>
        </G.Stack>
      </G.Section>
    </div>
  ),
};

/** Something waits on a person's yes: what it is in the label, who and why in a description list, the commit named for the act. */
export const NeedsApproval: Story = {
  render: () => (
    <div style={{ maxWidth: '32rem' }}>
      <G.SurfaceCard label="Send the quotation to the customer">
        <G.Stack gap="row">
          <G.DescriptionList
            items={[
              { id: 'who', term: 'Asked by', description: 'Linh, sales' },
              { id: 'why', term: 'Why', description: 'The customer asked for the new price before Friday.' },
              { id: 'what', term: 'Amount', description: '48,000,000' },
            ]}
          />
          <G.Cluster gap="inline" justify="end">
            <G.Button intent="dismiss" onPress={noop}>Not now</G.Button>
            <G.Button intent="alternative" onPress={noop}>Ask for changes</G.Button>
            <G.Button intent="commit" onPress={noop}>Approve and send</G.Button>
          </G.Cluster>
        </G.Stack>
      </G.SurfaceCard>
    </div>
  ),
};
