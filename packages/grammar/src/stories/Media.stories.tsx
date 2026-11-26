import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/**
 * Image, Video and Illustration: the media family. Every file is a small local fixture served at /media (never a remote host); each story
 * draws a state.
 */
const meta: Meta = { title: 'Media/Image, Video and Illustration', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const PHOTO = [
  { src: '/media/photo-320.svg', width: 320 },
  { src: '/media/photo-960.svg', width: 960 },
  { src: '/media/photo-1920.svg', width: 1920 },
] as const;
const SIZES = '(min-width: 64rem) 30rem, 100vw';
const RATIOS = ['1:1', '4:3', '16:9', '9:16', '21:9', 'auto'] as const;

const boxOf = (root: HTMLElement, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element for ${selector}`);
  return found;
};

/** Every ratio claims its box before the picture: the box has the ratio even while the file is still loading. */
export const ImageRatios: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      {RATIOS.map((ratio) => (
        <State key={ratio} label={`ratio ${ratio}, fit cover`} direction="column">
          <div style={{ maxWidth: ratio === '9:16' ? 180 : 480 }}>
            <G.Image src="/media/photo-960.svg" renditions={PHOTO} sizes={SIZES} alt={`A sample picture at ${ratio}`} ratio={ratio} fit="cover" />
          </div>
        </State>
      ))}
      <State label="fit contain in a 1:1 box" direction="column">
        <div style={{ maxWidth: 240 }}><G.Image src="/media/photo-960.svg" alt="A contained picture" ratio="1:1" fit="contain" /></div>
      </State>
    </Matrix>
  ),
};

/** Renditions become srcset and sizes; the picture is lazy and async-decoded; a caption makes it a figure. */
export const ImageRenditionsAndCaption: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="renditions, sizes and caption" direction="column">
        <div style={{ maxWidth: 480 }}>
          <G.Image src="/media/photo-960.svg" renditions={PHOTO} sizes={SIZES} alt="A sample picture" ratio="4:3" caption="A caption sits under the picture, in the muted caption step." />
        </div>
      </State>
      <State label="density renditions" direction="column">
        <div style={{ maxWidth: 240 }}>
          <G.Image src="/media/photo-320.svg" renditions={[{ src: '/media/photo-320.svg', density: 1 }, { src: '/media/photo-960.svg', density: 2 }]} alt="A density picture" ratio="1:1" />
        </div>
      </State>
      <State label="decorative: empty alt" direction="column">
        <div style={{ maxWidth: 240 }}><G.Image src="/media/photo-320.svg" alt="" ratio="1:1" /></div>
      </State>
    </Matrix>
  ),
};

/** Loading is a shimmer in the ready box; a file that fails leaves the plate with a neutral glyph that keeps the name. */
export const ImageStates: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="isLoading: the ready box under a shimmer" direction="column">
        <div style={{ maxWidth: 360 }}><G.Image src="/media/photo-960.svg" alt="Loading picture" ratio="16:9" isLoading /></div>
      </State>
      <State label="error: neutral placeholder" direction="column">
        <div style={{ maxWidth: 360 }}><G.Image src="/media/does-not-exist.svg" alt="Missing picture" ratio="16:9" /></div>
      </State>
      <State label="error with a caption" direction="column">
        <div style={{ maxWidth: 360 }}><G.Image src="/media/does-not-exist.svg" alt="Missing picture" ratio="4:3" caption="The caption stays when the file fails." /></div>
      </State>
    </Matrix>
  ),
};

/** The zoom opens the picture larger over the page; Escape and the close control dismiss it and focus returns. */
export const ImageZoom: Story = {
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <G.Image src="/media/photo-960.svg" renditions={PHOTO} alt="A zoomable picture" ratio="4:3" zoom={{ openLabel: 'Enlarge the picture', closeLabel: 'Close the picture' }} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const opener = within(canvasElement).getByRole('button', { name: 'Enlarge the picture' });
    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');
  },
};

/** A statics key resolves through the nearest StaticsProvider; a plain src stays for an already resolved URL. */
export const MediaStaticsKey: Story = {
  render: () => (
    <G.StaticsProvider baseUrl="/media/">
      <Matrix maxWidth={480}>
        <State label="Image staticsKey" direction="column"><G.Image staticsKey="photo-960.svg" alt="From statics" ratio="4:3" /></State>
        <State label="Illustration staticsKey" direction="column"><div style={{ maxWidth: 240 }}><G.Illustration staticsKey="art-square.svg" ratio="1:1" /></div></State>
        <State label="Video staticsKey and poster" direction="column">
          <G.Video title="From statics" sources={[{ staticsKey: 'clip.webm', type: 'video/webm' }]} poster={{ staticsKey: 'poster.svg' }} loading="eager" />
        </State>
      </Matrix>
    </G.StaticsProvider>
  ),
};

const TRACKS = [{ src: '/media/captions.vtt', kind: 'captions', srcLang: 'en', label: 'English captions', isDefault: true }] as const;

/** A WebM plays natively, with a poster and WebVTT captions; a shimmer covers the poster until the first frame. */
export const VideoNative: Story = {
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <G.Video title="A moving bar" sources={[{ src: '/media/clip.webm', type: 'video/webm' }]} poster={{ src: '/media/poster.svg' }} tracks={TRACKS} loading="eager" />
    </div>
  ),
};

/** No stream is requested until the box is near the viewport; scrolling it near attaches the source. */
export const VideoLazy: Story = {
  render: () => (
    <div>
      <div style={{ height: '220vh' }}><G.Text tone="muted">Scroll down: the video below attaches only when it nears the viewport.</G.Text></div>
      <div style={{ maxWidth: 560 }}><G.Video title="A lazy video" sources={[{ src: '/media/clip.webm', type: 'video/webm' }]} poster={{ src: '/media/poster.svg' }} /></div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const frame = boxOf(canvasElement, '[data-component="Video"]');
    frame.scrollIntoView();
  },
};

/** autoPlay means muted and inline; a loop with no controls is the background-video shape. */
export const VideoAutoPlay: Story = {
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <G.Video title="A background loop" sources={[{ src: '/media/clip.webm', type: 'video/webm' }]} autoPlay loop controls={false} ratio="1:1" loading="eager" />
    </div>
  ),
};

/** Auto-pick by type and capability is a pure choice: the first source, in the author's order, the browser can play. */
export const VideoSourcePick: Story = {
  render: () => <G.Text>The pick takes the first source, in the author's order, the browser can play.</G.Text>,
};

/** An HLS playlist on a browser with no native HLS loads hls.js by dynamic import (the fixture playlist has no segments, so the stream fails in place). */
export const VideoStreamLoadsPlayer: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="HLS source" direction="column">
        <G.Video title="An HLS stream" sources={[{ src: '/media/stream.m3u8', type: 'application/vnd.apple.mpegurl' }]} poster={{ src: '/media/poster.svg' }} loading="eager" />
      </State>
      <State label="DASH source" direction="column">
        <G.Video title="A DASH stream" sources={[{ src: '/media/stream.mpd', type: 'application/dash+xml' }]} poster={{ src: '/media/poster.svg' }} loading="eager" />
      </State>
    </Matrix>
  ),
};

/** A failed file and a list nothing in it can play each say so in the box, with the app's words when given. */
export const VideoStates: Story = {
  render: () => (
    <Matrix maxWidth={560}>
      <State label="isLoading: the ready box under a shimmer" direction="column">
        <G.Video title="Loading video" sources={[{ src: '/media/clip.webm', type: 'video/webm' }]} poster={{ src: '/media/poster.svg' }} isLoading />
      </State>
      <State label="error" direction="column">
        <G.Video title="Missing video" sources={[{ src: '/media/missing.webm', type: 'video/webm' }]} loading="eager" />
      </State>
      <State label="unsupported (no source to play), the app's words" direction="column">
        <G.Video title="Unsupported video" sources={[]} loading="eager" labels={{ unsupported: 'Your browser cannot play this recording.' }} />
      </State>
      <State label="9:16 ratio" direction="column">
        <div style={{ maxWidth: 200 }}><G.Video title="A portrait video" sources={[{ src: '/media/clip.webm', type: 'video/webm' }]} poster={{ src: '/media/poster.svg' }} ratio="9:16" /></div>
      </State>
    </Matrix>
  ),
};

const HeroDemo = () => (
  <G.Grid
    kind="pair"
    leading={
      <G.Stack gap="section">
        <G.Heading level={1} scale="display">Plan the work, not the paperwork</G.Heading>
        <G.Text tone="muted">One calm place for your team to decide what happens next.</G.Text>
        <G.Cluster gap="inline"><G.Button variant="primary" size="lg">Start free</G.Button></G.Cluster>
      </G.Stack>
    }
    trailing={
      <G.Illustration src="/media/art-wide.svg" compact={{ src: '/media/art-compact.svg', ratio: '4:3' }} ratio="21:9" assetSlot="landing.hero" />
    }
  />
);

/** A landing hero: the art sits beside the headline and is another crop (and ratio) on a phone. */
export const IllustrationHero: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => <div style={{ padding: 'var(--grammar-page-inset, 1rem)' }}><HeroDemo /></div>,
};

/** Loading, error and meaningful art: the plate stays, the art never carries the only copy. */
export const IllustrationStates: Story = {
  render: () => (
    <Matrix maxWidth={480}>
      <State label="isLoading" direction="column"><div style={{ maxWidth: 240 }}><G.Illustration src="/media/art-square.svg" ratio="1:1" isLoading /></div></State>
      <State label="error: the plate with no mark" direction="column"><div style={{ maxWidth: 240 }}><G.Illustration src="/media/missing.svg" ratio="1:1" /></div></State>
      <State label="meaningful: a non-empty alt names it" direction="column"><div style={{ maxWidth: 240 }}><G.Illustration src="/media/art-square.svg" ratio="1:1" alt="A team around a table" /></div></State>
      <State label="21:9 banner" direction="column"><G.Illustration src="/media/art-wide.svg" ratio="21:9" /></State>
    </Matrix>
  ),
};
