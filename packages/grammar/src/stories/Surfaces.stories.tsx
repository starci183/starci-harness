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
 * A Core PANEL card carries its title inside the card (the card header), inset from the boundary: the label row keeps a
 * non-zero inline padding (0.13.0 fix). Offset Pop keeps a panel title outside, flush with the card edge like every label.
 */
export const SurfaceCardLabelInset: Story = {
  name: 'SurfaceCard panel title inset',
  render: () => (
    <div style={{ maxWidth: 480 }}>
      <G.SurfaceCard label="Group info" placement="panel">
        <G.Text>Keep the streak going with one short lesson a day.</G.Text>
      </G.SurfaceCard>
    </div>
  ),
  play: async ({ canvasElement, globals }) => {
    const inside = (globals['grammarFamily'] ?? 'core') === 'core';
    await waitFor(() => {
      const label = canvasElement.querySelector<HTMLElement>('[data-component="SurfaceCard"] > [data-grammar-surface-label]');
      expect(label).not.toBeNull();
      const style = getComputedStyle(label as HTMLElement);
      for (const side of [style.paddingInlineStart, style.paddingInlineEnd]) {
        if (inside) expect(Number.parseFloat(side)).toBeGreaterThan(0);
        else expect(Number.parseFloat(side)).toBe(0);
      }
    });
  },
};

/** Each family's own card-label decision (ruling card-label-placement-per-grammar): where a PANEL card's title sits. */
const PANEL_TITLE: Readonly<Record<string, 'inside' | 'outside'>> = { core: 'inside', 'offset-pop': 'outside' };

const dnaPlanOptions = [
  { id: 'starter', label: 'Starter' },
  { id: 'team', label: 'Team' },
];

/** A page that mixes a floating card in the content flow with a docked panel column, as a chat's details pane. */
const FloatingAndPanelPage = () => (
  <div data-story-dna-page="true" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 20rem', gap: '1.5rem', alignItems: 'stretch', minHeight: '34rem' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>
      <G.SectionHeader title="Weekly review" description="A floating card among other content, with a nested card inside." level={2} />
      <div data-story-dna="floating">
        <G.SurfaceCard label="This week" fact="3 lessons">
          <G.Text>Keep the streak going with one short lesson a day.</G.Text>
          <G.Divider />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div data-story-dna="nested">
            <G.SurfaceCard label="Nested card" fact="2 seats">
              <G.Text>A surface placed on a surface: border, no shadow.</G.Text>
            </G.SurfaceCard>
          </div>
          <div data-story-dna="controls" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
            <G.Input id="dna-input" name="name" label="Name" />
            <G.Select label="Plan" options={dnaPlanOptions} defaultValue="team" />
            <G.Button intent="commit" onPress={noop}>Save</G.Button>
          </div>
          </div>
        </G.SurfaceCard>
      </div>
    </div>
    <div data-story-dna="panel" style={{ display: 'flex', minWidth: 0 }}>
      <G.SurfaceCard label="Group info" placement="panel" height="fill">
        <G.Text tone="muted">12 members, created 3 March.</G.Text>
        <G.Text>A docked panel of the layout carries its title as its header.</G.Text>
      </G.SurfaceCard>
    </div>
  </div>
);

const rectOf = (element: Element) => element.getBoundingClientRect();
/** A shadow that draws something: any layer left once the transparent zero layers are removed. */
const raised = (element: Element) => /px/.test(getComputedStyle(element).boxShadow.replaceAll(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px,? ?/g, ''));

/** Every DNA rule the page breaks for `family`, as readable lines. */
const dnaProblems = (scope: Element, family: string): string[] => {
  const problems: string[] = [];
  const card = (slot: string) => scope.querySelector(`[data-story-dna="${slot}"] > [data-component="SurfaceCard"]`);
  const partsOf = (root: Element | null) => ({
    label: root?.querySelector(':scope > [data-grammar-surface-label]') ?? null,
    material: root?.querySelector(':scope > [data-grammar-frame="bounded"], :scope > [data-grammar-highlight] > [data-grammar-frame="bounded"]') ?? null,
  });
  const painted = (element: Element) => {
    const style = getComputedStyle(element);
    return style.backgroundColor !== 'rgba(0, 0, 0, 0)' || raised(element) || Number.parseFloat(style.borderTopWidth) > 0;
  };

  const floating = card('floating');
  const f = partsOf(floating);
  if (floating === null || f.label === null || f.material === null) problems.push('floating card: label or material missing');
  else {
    if (rectOf(f.label).bottom > rectOf(f.material).top + 0.5) problems.push(`floating card: label bottom ${rectOf(f.label).bottom.toFixed(1)} below material top ${rectOf(f.material).top.toFixed(1)}`);
    if (painted(floating)) problems.push('floating card: the root around the label is painted');
    if (!painted(f.material)) problems.push('floating card: the material box is not painted');
  }

  const panel = card('panel');
  const p = partsOf(panel);
  if (panel === null || p.label === null || p.material === null) problems.push('panel card: title or material missing');
  else if ((PANEL_TITLE[family] ?? 'outside') === 'inside') {
    const box = rectOf(panel);
    const title = rectOf(p.label.firstElementChild ?? p.label);
    if (!painted(panel)) problems.push('panel card: the card box around the title is not painted');
    if (title.top < box.top || title.left < box.left + 1 || title.right > box.right) problems.push('panel card: the title is not inside the material');
  } else if (rectOf(p.label).bottom > rectOf(p.material).top + 0.5) problems.push('panel card: this family keeps the title outside, but it overlaps the material');

  const nested = partsOf(card('nested')).material;
  if (nested === null) problems.push('nested card: material missing');
  else {
    const style = getComputedStyle(nested);
    if (!(Number.parseFloat(style.borderTopWidth) > 0)) problems.push('nested card: no border');
    if (raised(nested)) problems.push(`nested card: raised (${style.boxShadow})`);
  }

  const divider = scope.querySelector('[data-story-dna="floating"] [data-grammar-surface-content] > [data-component="Divider"]');
  if (divider === null || f.material === null) problems.push('divider missing');
  else {
    const d = rectOf(divider);
    // The card's edges are the inside of its border (an Offset Pop outline is the border itself).
    const m = rectOf(f.material);
    const border = getComputedStyle(f.material);
    const inner = { left: m.left + Number.parseFloat(border.borderLeftWidth), right: m.right - Number.parseFloat(border.borderRightWidth) };
    const inset = Math.max(Math.abs(d.left - inner.left), Math.abs(inner.right - d.right));
    if (inset > 1.5) problems.push(`divider inset ${inset.toFixed(1)}px (full bleed is 0)`);
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
 * The family DNA on one page, light and dark: a FLOATING card (label above the material, the page's commonest card), a
 * docked PANEL card (Core: title inside, as the header; Offset Pop: outside), a nested surface (border, no shadow), a
 * full-bleed divider (inset 0) and the 40px controls (Input, Select, Button).
 */
export const FloatingCardAndPanel: Story = {
  parameters: { grammar: { bleed: false } },
  render: (_, { globals }) => (
    <Matrix>
      {(['light', 'dark'] as const).map((theme) => (
        <G.GrammarRoot key={theme} {...familyScope(globals)} theme={theme} data-story-dna-theme={theme} style={{ padding: '1.5rem', background: 'var(--background, Canvas)' }}>
          <FloatingAndPanelPage />
        </G.GrammarRoot>
      ))}
    </Matrix>
  ),
  play: async ({ canvasElement, globals }) => {
    const family = typeof globals['grammarFamily'] === 'string' ? globals['grammarFamily'] : 'core';
    await waitFor(() => {
      const problems = [...canvasElement.querySelectorAll('[data-story-dna-theme]')].flatMap((root) =>
        dnaProblems(root, family).map((problem) => `${root.getAttribute('data-story-dna-theme')}: ${problem}`));
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
      <State label="Contextual surface depth" direction="column">
        <G.SurfaceCard label="Outer">
          <G.SurfaceCard label="Nested"><G.Text>Nested depth.</G.Text></G.SurfaceCard>
        </G.SurfaceCard>
      </State>
      <State label="Ink band with artwork and orbit motif (joined faces, stat strip, unlabelled divider)" direction="column">
        <G.SurfaceCard
          ariaLabel="Workspace overview"
          treatment="ink"
          composition="joined"
          motif="orbit"
          artwork={<G.Image src={placeholderImage('Art', 20)} alt="" fit="contain" loading="eager" assetSlot="story.overview-art" />}
        >
          <div style={{ padding: '1.5rem', maxWidth: '30rem' }}>
            <G.SectionHeader eyebrow="Overview" title="Workspace Support" description="Owner Alex Morgan · Team plan" />
          </div>
          <G.Divider semantics="presentation" />
          <div style={{ padding: '1.5rem' }}>
            <G.DescriptionList
              layout="stat-strip"
              items={[
                { id: 'runtime', icon: BookGlyph, term: 'Runtime', description: <G.Badge tone="success" isDot>Provisioned</G.Badge>, meta: 'Verified 10:00' },
                { id: 'installs', icon: BookGlyph, term: 'Installations', description: '2', unit: 'modules', meta: 'Inventoried 10:00' },
                { id: 'capabilities', icon: BookGlyph, term: 'Capabilities on', description: '5/6', meta: '1 capability off' },
                { id: 'conversations', icon: BookGlyph, term: 'Conversations · 7 days', description: '1,596', unit: 'conversations', meta: 'Across 2 modules' },
              ]}
            />
          </div>
        </G.SurfaceCard>
        <G.SurfaceCard ariaLabel="Ink band, motif only" treatment="ink" motif="orbit">
          <G.SectionHeader title="Motif without artwork" description="The orbit stays in the artwork zone, never behind the copy." />
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
              <G.SectionHeader eyebrow="Getting started" title="Set up your workspace" description="Three short steps, about two minutes." />
              <G.Text tone="muted">You can change everything later in settings.</G.Text>
              <G.Text tone="accent">Step 1 of 3</G.Text>
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

export const SurfaceListCard: Story = {
  render: () => (
    <Matrix maxWidth={640}>
      <State label="Rows with states" direction="column">
        <G.SurfaceListCard label="Checks" fact="4 items" footer={<G.Text tone="muted" size="sm">Updated just now.</G.Text>}>
          <G.StaticStateRow item={{ id: 'a', label: 'Email verified', state: 'affirmative' }} />
          <G.StaticStateRow item={{ id: 'b', label: 'Payment method', description: 'Expires soon', state: 'cautionary' }} />
          <G.StaticStateRow item={{ id: 'c', label: 'Two-factor', state: 'negative' }} />
          <G.StaticStateRow item={{ id: 'd', label: 'Backup', state: 'pending' }} />
        </G.SurfaceListCard>
      </State>
      <State label="Verdict collection" direction="column">
        <G.SurfaceListCard label="Movement" isVerdict>
          <G.StaticStateRow item={{ id: 'up', label: 'Ada', verdict: 'success' }} />
          <G.StaticStateRow item={{ id: 'down', label: 'Grace', verdict: 'danger' }} />
        </G.SurfaceListCard>
      </State>
      <State label="Loading (pending)" direction="column">
        <G.SurfaceListCard label="Loading" isLoading>
          <G.StaticStateRow item={{ id: 'l', label: 'Loading row', state: 'pending' }} />
        </G.SurfaceListCard>
      </State>
      <State label="Loading (3 skeleton rows by default)" direction="column">
        <G.SurfaceListCard label="Saved lessons" isLoading />
      </State>
      <State label="Empty (notice, not a list)" direction="column">
        <G.SurfaceListCard label="Saved" empty={<G.EmptyNotice message="Nothing saved yet." description="Saved lessons appear here." />} />
      </State>
      <State label="Contained scroll (focusable list)" direction="column">
        <div style={{ height: 160, display: 'flex', flexDirection: 'column' }}>
          <G.SurfaceListCard label="History" isScrollable>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <G.StaticStateRow key={day} item={{ id: day, label: day, description: 'One lesson', state: 'affirmative' }} />
            ))}
          </G.SurfaceListCard>
        </div>
      </State>
    </Matrix>
  ),
};

const StaticRows = () => (
  <G.SurfaceListCard ariaLabel="Every presentation state" labelHidden>
    {G.PRESENTATION_STATES.map((state) => (
      <G.StaticStateRow key={state} item={{ id: state, label: state, description: `A ${state} row` , state }} />
    ))}
  </G.SurfaceListCard>
);

/** `ListRow`: an interactive row on the static row's geometry - leading mark, title with badges, one line, actions, a detail region. */
export const ListRow: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Several accounts of one provider" direction="column">
        <G.SurfaceListCard label="Bank feed" fact="3 accounts" labelEnd={<G.Button variant="ghost" onPress={noop}>Add</G.Button>}>
          <G.ListRow
            leading={<G.IconTile source={BookGlyph} />}
            title="Main account"
            badges={<><G.Badge tone="success" isDot>Connected</G.Badge><G.Badge tone="neutral">Test</G.Badge></>}
            description="Bank A · •••• 4321 · Holder name · Used by: Accounting"
            actions={<G.IconButton source={PlusGlyph} label="Options for Main account" variant="ghost" onPress={noop} />}
          />
          <G.ListRow
            leading={<G.IconTile source={BookGlyph} />}
            title="Second account"
            badges={<G.Badge tone="warning" isDot>Unfinished</G.Badge>}
            description="Bank A · •••• 1234 · Holder name"
            actions={<><G.Button variant="secondary" onPress={noop}>Continue</G.Button><G.IconButton source={PlusGlyph} label="Options for Second account" variant="ghost" onPress={noop} /></>}
            state="cautionary"
          />
          <G.ListRow
            leading={<G.IconTile source={BookGlyph} />}
            title="Old account"
            badges={<G.Badge tone="danger" isDot>Needs attention</G.Badge>}
            description="Bank B · •••• 9876"
            actions={<G.IconButton source={PlusGlyph} label="Options for Old account" variant="ghost" onPress={noop} />}
            state="negative"
          >
            <G.Alert tone="negative" title="The provider rejected the last delivery" description="Check the key on the provider, then send a test." />
          </G.ListRow>
        </G.SurfaceListCard>
      </State>
      <State label="Offers without a leading mark, mixed with a static row" direction="column">
        <G.SurfaceListCard label="Not connected">
          <G.ListRow title="Chat bot" description="Customers message your bot." actions={<G.Button variant="outline" onPress={noop}>Connect</G.Button>} />
          <G.StaticStateRow item={{ id: 'static', label: 'Static row', description: 'Shares the same inset and separator' }} />
        </G.SurfaceListCard>
      </State>
    </Matrix>
  ),
};

export const StaticStateRow: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="Every presentation state" direction="column"><StaticRows /></State>
    </Matrix>
  ),
};

type Summary = { readonly title: string; readonly meta: string };

const AccordionCardDemo = () => {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(['week-1']));
  const weeks = [
    { id: 'week-1', summary: { title: 'Week 1', meta: '3 lessons' }, body: 'Articles, plurals and pronouns.' },
    { id: 'week-2', summary: { title: 'Week 2', meta: '4 lessons' }, body: 'Present tenses.' },
    { id: 'week-3', summary: { title: 'Week 3', meta: 'Locked' }, body: 'Past tenses.', isDisabled: true },
  ];
  return (
    <G.SurfaceAccordionCard<Summary, string>
      label="Course outline"
      items={weeks.map((week) => ({
        id: week.id,
        isOpen: open.has(week.id),
        isDisabled: week.isDisabled === true,
        summaryRender: week.summary,
        bodyRender: week.body,
      }))}
      onItemOpenChange={(id, isOpen) =>
        setOpen((current) => {
          const next = new Set(current);
          if (isOpen) next.add(id);
          else next.delete(id);
          return next;
        })
      }
      renderSummary={(summary) => (
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', width: '100%' }}>
          <span>{summary.title}</span>
          <G.Text as="span" tone="muted" size="sm">{summary.meta}</G.Text>
        </span>
      )}
      renderBody={(body) => <G.Text>{body}</G.Text>}
    />
  );
};

const SingleAccordionDemo = ({ frame }: Pick<G.SurfaceAccordionCardProps<string, string>, 'frame'> = {}) => {
  const [isOpen, setOpen] = useState(false);
  return (
    <G.SurfaceAccordionCard<string, string>
      ariaLabel="Refund policy"
      {...(frame === undefined ? {} : { frame })}
      isOpen={isOpen}
      onOpenChange={setOpen}
      summaryRender="Refund policy"
      bodyRender="Refunds are available within 14 days."
      renderSummary={(summary) => summary}
      renderBody={(body) => <G.Text>{body}</G.Text>}
    />
  );
};

export const SurfaceAccordionCard: Story = {
  render: () => (
    <Matrix maxWidth={640}>
      <State label="Rows: one open (selected), one disabled" direction="column"><AccordionCardDemo /></State>
      <State label="Single item, collapsed" direction="column"><SingleAccordionDemo /></State>
      <State label="Bounded disclosure inherits nested depth" direction="column">
        <G.SurfaceCard label="Course details"><SingleAccordionDemo /></G.SurfaceCard>
      </State>
      <State label="Unpainted disclosure inherits its parent's surface" direction="column">
        <G.SurfaceCard label="Course details"><SingleAccordionDemo frame="unpainted" /></G.SurfaceCard>
      </State>
    </Matrix>
  ),
};

export const SurfaceCopyGroup: Story = {
  render: () => (
    <Matrix maxWidth={480}>
      <State label="Compact and comfortable" direction="column">
        <G.SurfaceCard ariaLabel="Compact copy">
          <G.SurfaceCopyGroup density="compact">
            <G.Heading level={3}>Compact rhythm</G.Heading>
            <G.Text tone="muted">Title and explanation sit 0.5rem apart.</G.Text>
          </G.SurfaceCopyGroup>
        </G.SurfaceCard>
        <G.SurfaceCard ariaLabel="Comfortable copy">
          <G.SurfaceCopyGroup density="comfortable">
            <G.Heading level={3}>Comfortable rhythm</G.Heading>
            <G.Text tone="muted">A looser pairing for longer copy.</G.Text>
          </G.SurfaceCopyGroup>
        </G.SurfaceCard>
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
        <G.EmptyNotice message="Nothing to import." actionLabel="Refresh" actionVariant="secondary" isActionPending onAction={noop} />
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

export const SectionHeader: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Section header with eyebrow and action" direction="column">
        <G.SectionHeader eyebrow="Course" title="Grammar basics" description="Twelve short lessons." action={<G.Button variant="secondary" size="sm">Share</G.Button>} level={2} />
      </State>
      <State label="Context intro" direction="column">
        <G.SectionHeader composition="context-intro" title="Welcome back" description="Pick up where you left off." level={2} />
      </State>
      <State label="Count and trailing source meta" direction="column">
        <G.SectionHeader title="Installations" count={2} meta="Inventoried at 10:00, 26 Sep 2026 (GMT+7)" level={2} />
      </State>
      <State label="Loading (isSkeleton)" direction="column">
        <G.SectionHeader eyebrow="Course" title="Grammar basics" description="Twelve short lessons." meta="Updated now" action={<G.Button variant="secondary" size="sm">Share</G.Button>} level={2} isSkeleton />
      </State>
    </Matrix>
  ),
};

export const MediaFrame: Story = {
  render: () => (
    <Matrix maxWidth={640}>
      <State label="Framed with caption">
        <div style={{ width: 320 }}>
          <G.MediaFrame caption="Figure 1. Placeholder artwork.">
            <img src={placeholderImage('Framed')} alt="Placeholder artwork" />
          </G.MediaFrame>
        </div>
      </State>
      <State label="Plain, square, contain">
        <div style={{ width: 200 }}>
          <G.MediaFrame treatment="plain" aspect="square" fit="contain">
            <img src={placeholderImage('Plain', 160)} alt="Plain placeholder artwork" />
          </G.MediaFrame>
        </div>
      </State>
      <State label="Asset slot (data-asset-slot / -sha256 / -prompt)">
        <div style={{ width: 200 }}>
          <G.MediaFrame treatment="plain" assetSlot="story.hero" assetSha256="0000" assetPrompt="Placeholder until interface.asset delivers the art">
            <img src={placeholderImage('Slot', 200)} alt="" />
          </G.MediaFrame>
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
        <G.FencedCodeBlock language="tsx" code={'import { CoreGrammarRoot } from "@starci/grammar/core"\n\nexport const App = () => <CoreGrammarRoot>…</CoreGrammarRoot>'} action={<G.Button size="sm" variant="ghost">Copy</G.Button>} />
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

export const Rail: Story = {
  render: () => (
    <Matrix>
      <State label="Complementary rail with footer">
        <div style={{ height: 320, display: 'flex' }}>
          <G.Rail label="Progress" width="standard" footer={<G.Text tone="muted" size="sm">Updated daily.</G.Text>}>
            <G.Progress label="Course" value={40} />
            <G.Meter label="Weekly goal" value={3} maxValue={5} valueLabel="3 of 5" />
          </G.Rail>
        </div>
      </State>
      <State label="Content navigation, pending state">
        <div style={{ height: 320, display: 'flex' }}>
          <G.Rail landmark="content-navigation" width="compact" state="pending">
            <G.Link href="#intro" isCurrent>Introduction</G.Link>
            <G.Link href="#rules">Rules</G.Link>
            <G.Link href="#practice">Practice</G.Link>
          </G.Rail>
        </div>
      </State>
    </Matrix>
  ),
};
