import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { BookGlyph, HomeGlyph, Matrix, State, familyScope, noop } from './fixtures.js';

/**
 * The owner's status pair rule (ruling `status-soft-pair-on-background`): content on a tone background wears the pair
 * `x-soft` and `x-soft-foreground`; a mark that stands alone wears `x`. These stories draw the places the rule reaches in
 * the grammar's own CSS: the alert dialog's icon tile (on its tint) and the footer note of a surface list.
 */
const meta: Meta = {
  title: 'Status pair',
};
export default meta;

type Story = StoryObj;

const stripItems: ReadonlyArray<G.DescriptionListStatItem> = [
  { id: 'lessons', icon: BookGlyph, term: 'Lessons', description: '12', unit: 'done', meta: 'This month' },
  { id: 'streak', icon: HomeGlyph, term: 'Streak', description: '9', unit: 'days', meta: 'Best 14' },
  { id: 'score', term: 'Score', description: '86%', meta: 'Last quiz' },
  { id: 'time', term: 'Time', description: '4.5', unit: 'h', meta: '7 days' },
];

const openParameters = { grammar: { minHeight: '30rem' } };

const dialogTone = (tone: 'negative' | 'affirmative' | 'cautionary' | 'informative'): Story => ({
  parameters: openParameters,
  render: () => (
    <G.AlertDialog
      defaultOpen
      tone={tone}
      title="Apply this change?"
      description="The icon tile sits on the tint of the tone, so its glyph wears the tone's soft foreground."
      confirmLabel="Apply"
      cancelLabel="Not now"
      onConfirm={noop}
      trigger={<G.Button variant="outline">Open</G.Button>}
    />
  ),
});

export const AlertDialogNegative: Story = dialogTone('negative');
export const AlertDialogAffirmative: Story = dialogTone('affirmative');
export const AlertDialogCautionary: Story = dialogTone('cautionary');
export const AlertDialogInformative: Story = dialogTone('informative');

/** The footer of a SurfaceListCard: a small muted line under the card, the full width of the list, in light and dark. */
export const SurfaceListCardFooter: Story = {
  render: (_, { globals }) => (
    <Matrix maxWidth={720}>
      {(['light', 'dark'] as const).map((theme) => (
        <G.GrammarRoot key={theme} {...familyScope(globals)} theme={theme} data-story-footer-theme={theme} style={{ padding: '1.5rem', background: 'var(--background, Canvas)' }}>
          <State label={`${theme}: a plain-text footer`} direction="column">
            <div style={{ width: 640, maxWidth: '100%' }}>
              <G.SurfaceListCard label="Permissions" fact="3 rules" footer="Locked rules are set by the workspace owner.">
                <G.ListRow leading={<G.IconTile source={BookGlyph} />} title="Read the knowledge" description="Customers and every agent" />
                <G.ListRow leading={<G.IconTile source={BookGlyph} />} title="Write notes" description="Agents only" />
                <G.ListRow leading={<G.IconTile source={BookGlyph} />} title="Share outside the workspace" description="Nobody" />
              </G.SurfaceListCard>
            </div>
          </State>
          <State label={`${theme}: a footer that is a muted Text`} direction="column">
            <div style={{ width: 640, maxWidth: '100%' }}>
              <G.SurfaceListCard label="Permissions" fact="2 rules" footer={<G.Text tone="muted">Locked rules are set by the workspace owner.</G.Text>}>
                <G.ListRow leading={<G.IconTile source={BookGlyph} />} title="Read the knowledge" description="Customers and every agent" />
                <G.ListRow leading={<G.IconTile source={BookGlyph} />} title="Write notes" description="Agents only" />
              </G.SurfaceListCard>
            </div>
          </State>
        </G.GrammarRoot>
      ))}
    </Matrix>
  ),
};

/** A joined card: the stat strip as one band and a Meter as the band below it, in light and dark. */
export const JoinedStripWithMeter: Story = {
  render: (_, { globals }) => (
    <Matrix maxWidth={720}>
      {(['light', 'dark'] as const).map((theme) => (
        <G.GrammarRoot key={theme} {...familyScope(globals)} theme={theme} data-story-joined-theme={theme} style={{ padding: '1.5rem', background: 'var(--background, Canvas)' }}>
          <State label={`${theme}: joined card, the strip and a Meter`} direction="column">
            <div style={{ width: 672, maxWidth: '100%' }}>
              <G.SurfaceCard ariaLabel="Usage" composition="joined">
                <G.DescriptionList layout="stat-strip" items={stripItems} />
                <G.Divider semantics="presentation" />
                <div style={{ padding: 'var(--grammar-inset, 0.75rem)' }}>
                  <G.Meter label="Storage" value={64} valueLabel="6.4 of 10 GB" />
                </div>
              </G.SurfaceCard>
            </div>
          </State>
        </G.GrammarRoot>
      ))}
    </Matrix>
  ),
};
