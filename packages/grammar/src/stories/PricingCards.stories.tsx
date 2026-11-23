import type { Meta, StoryObj } from '@storybook/react-vite';
import { TablerCircleCheck } from '../core/leaf/Icon/tabler.js';
import * as G from '../common/index.js';

const meta: Meta = { title: 'Surfaces/Pricing cards', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const PLANS = [
  { id: 'starter', name: 'Starter', price: '$99/month', features: ['Up to 2 people', '2,000 AI credits a month'] },
  { id: 'team', name: 'Team', price: '$249/month', features: ['Up to 5 people', '8,000 AI credits a month'], popular: true },
  { id: 'business', name: 'Business', price: '$499/month', features: ['Up to 15 people', '24,000 AI credits a month'] },
] as const;

/** A pricing grid: the leading value of each card at the figure size (FONT-5), the recommended plan with the accent ring and a badge, steps finished with a check. */
export const PricingGrid: Story = {
  render: () => (
    <G.Stack gap="region">
      <G.Stepper
        label="Create a workspace"
        currentStepId="plan"
        steps={[
          { id: 'business', label: 'Business' },
          { id: 'channels', label: 'Channels' },
          { id: 'ai', label: 'Hand to AI' },
          { id: 'plan', label: 'Plan' },
        ]}
      />
      <G.Grid kind="cards" columns={3}>
        {PLANS.map((plan) => (
          <G.SurfaceCard
            key={plan.id}
            ariaLabel={plan.name}
            {...('popular' in plan ? { emphasis: 'accent' as const } : {})}
          >
            <G.Stack gap="row">
              <G.Cluster gap="inline" justify="between">
                <G.Heading level={2}>{plan.name}</G.Heading>
                {'popular' in plan ? <G.Badge tone="accent">Most popular</G.Badge> : null}
              </G.Cluster>
              <G.Text role="figure">{plan.price}</G.Text>
              <G.Button variant={'popular' in plan ? 'primary' : 'border'} width="fill">{`Choose ${plan.name}`}</G.Button>
            </G.Stack>
            <G.Stack gap="row">
              {plan.features.map((feature) => (
                <G.Text key={feature} role="body" startContent={<G.Icon source={TablerCircleCheck} usage="control" />}>{feature}</G.Text>
              ))}
            </G.Stack>
          </G.SurfaceCard>
        ))}
      </G.Grid>
    </G.Stack>
  ),
};
