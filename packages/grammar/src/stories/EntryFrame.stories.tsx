import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { placeholderImage } from './fixtures.js';

const meta: Meta = { title: 'Frames/EntryFrame', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;

const EntryDemo = ({ state = 'ready', long = false }: { readonly state?: 'ready' | 'loading' | 'error'; readonly long?: boolean }) => (
  <G.EntryFrame
    label="Access your workspace"
    artwork={<G.Image src={placeholderImage('A welcoming place to begin', 1200)} alt="" aspect="portrait" fit="cover" plate="none" />}
    intro={
      <G.Stack gap="inline">
        <G.Heading level={1}>{long ? 'One secure place for the work you do together, wherever the day begins' : 'A clear place to begin'}</G.Heading>
        <G.Text tone="muted">Keep your people, decisions and next steps together.</G.Text>
      </G.Stack>
    }
    identity={<G.Text isStrong>Northstar</G.Text>}
    tools={<G.Link href="#language">Language and region</G.Link>}
    footer={
      <G.NavLandmark label="Legal information" layout="bar">
        <G.Link href="#privacy">Privacy</G.Link>
        <G.Link href="#terms">Terms</G.Link>
      </G.NavLandmark>
    }
  >
    <G.Stack gap="section">
      <G.Stack gap="inline">
        <G.Heading level={2}>Sign in</G.Heading>
        <G.Text tone="muted">{long ? 'Use the address your organisation invited so the right workspace and access remain connected.' : 'Use your workspace email to continue.'}</G.Text>
      </G.Stack>
      {state === 'error' ? <G.Alert title="We could not complete sign-in" description="Check your connection, then try again." tone="negative" /> : null}
      <G.Input id="entry-email" name="email" label="Email address" kind="email" isLoading={state === 'loading'} />
      <G.Input id="entry-password" name="password" label="Password" kind="password" isLoading={state === 'loading'} />
      <G.Button intent="commit" width="fill" isLoading={state === 'loading'}>Continue</G.Button>
    </G.Stack>
  </G.EntryFrame>
);

export const Ready: Story = { render: () => <EntryDemo /> };
export const LongCopy: Story = { render: () => <EntryDemo long /> };
export const LoadingForm: Story = { render: () => <EntryDemo state="loading" /> };
export const ErrorForm: Story = { render: () => <EntryDemo state="error" /> };
