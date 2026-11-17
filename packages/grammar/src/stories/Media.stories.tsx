import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/**
 * Image, Video and Illustration: the media family. Every file is a small local fixture served at /media (never a remote host); each story
 * draws a state and its play function proves it, at 1440 and at 390 (`npm run prove-plays`).
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
  play: async ({ canvasElement }) => {
    const expected: Record<string, number> = { '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '21:9': 21 / 9 };
    for (const [ratio, value] of Object.entries(expected)) {
      const box = boxOf(canvasElement, `.starci-core-image[data-grammar-image-ratio="${ratio}"]`);
      const { width, height } = box.getBoundingClientRect();
      expect(Math.abs(width / height - value)).toBeLessThan(0.02);
    }
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-grammar-image-state="loaded"]').length).toBeGreaterThanOrEqual(6));
  },
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
  play: async ({ canvasElement }) => {
    const figure = boxOf(canvasElement, 'figure[data-component="Image"]');
    expect(figure.querySelector('figcaption')?.textContent).toContain('A caption sits under the picture');
    const image = boxOf(figure, 'img') as HTMLImageElement;
    expect(image.getAttribute('srcset')).toBe('/media/photo-320.svg 320w, /media/photo-960.svg 960w, /media/photo-1920.svg 1920w');
    expect(image.getAttribute('sizes')).toBe(SIZES);
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('decoding')).toBe('async');
    expect(boxOf(canvasElement, 'img[srcset^="/media/photo-320.svg 1x"]').getAttribute('srcset')).toBe('/media/photo-320.svg 1x, /media/photo-960.svg 2x');
    expect(canvasElement.querySelectorAll('img[alt=""]').length).toBe(1);
    await waitFor(() => expect(image.complete && image.naturalWidth > 0).toBe(true));
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-grammar-image-state="error"]').length).toBe(2));
    const failed = canvasElement.querySelector('[data-grammar-image-fallback="true"]');
    expect(failed?.getAttribute('role')).toBe('img');
    expect(failed?.getAttribute('aria-label')).toBe('Missing picture');
    const box = boxOf(canvasElement, '[data-grammar-image-state="error"]').getBoundingClientRect();
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.02);
    expect(canvasElement.querySelector('.starci-core-image-skeleton, .starci-core-skeleton-placeholder')).not.toBeNull();
  },
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
    const dialog = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-component="ImageLightbox"]');
      if (found === null) throw new Error('the lightbox is not open yet');
      return found;
    });
    expect(dialog.getAttribute('aria-label')).toBe('A zoomable picture');
    expect(dialog.querySelector('img')?.getAttribute('alt')).toBe('A zoomable picture');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[data-component="ImageLightbox"]')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
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
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(boxOf(canvasElement, '[data-component="Image"] img').getAttribute('src')).toBe('/media/photo-960.svg'));
    expect(boxOf(canvasElement, '[data-component="Illustration"] img').getAttribute('src')).toBe('/media/art-square.svg');
    expect(boxOf(canvasElement, 'video').getAttribute('poster')).toBe('/media/poster.svg');
    expect(G.staticsUrl('/media/', 'a/b.png')).toBe('/media/a/b.png');
    expect(G.staticsUrl('/media/', 'a/b c.png')).toBeNull();
    expect(G.staticsUrl('/media', '../secret')).toBeNull();
    expect(G.staticsUrl('/media', 'https://host/x.png')).toBeNull();
  },
};

const TRACKS = [{ src: '/media/captions.vtt', kind: 'captions', srcLang: 'en', label: 'English captions', isDefault: true }] as const;

/** A WebM plays natively, with a poster and WebVTT captions; a shimmer covers the poster until the first frame. */
export const VideoNative: Story = {
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <G.Video title="A moving bar" sources={[{ src: '/media/clip.webm', type: 'video/webm' }]} poster={{ src: '/media/poster.svg' }} tracks={TRACKS} loading="eager" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const frame = boxOf(canvasElement, '[data-component="Video"]');
    const video = boxOf(frame, 'video') as HTMLVideoElement;
    expect(video.getAttribute('aria-label')).toBe('A moving bar');
    expect(video.controls).toBe(true);
    expect(video.getAttribute('poster')).toBe('/media/poster.svg');
    expect(video.querySelector('track')?.getAttribute('kind')).toBe('captions');
    await waitFor(() => expect(frame.getAttribute('data-grammar-video-status')).toBe('ready'), { timeout: 8000 });
    expect(frame.getAttribute('data-grammar-video-playback')).toBe('native');
    expect(video.readyState).toBeGreaterThanOrEqual(2);
    const box = frame.getBoundingClientRect();
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.02);
  },
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
    const video = boxOf(frame, 'video') as HTMLVideoElement;
    expect(frame.getAttribute('data-grammar-video-attached')).toBe('false');
    expect(video.getAttribute('src')).toBeNull();
    expect(video.getAttribute('preload')).toBe('none');
    frame.scrollIntoView();
    await waitFor(() => expect(frame.getAttribute('data-grammar-video-attached')).toBe('true'));
    await waitFor(() => expect(video.getAttribute('src')).toContain('/media/clip.webm'));
  },
};

/** autoPlay means muted and inline; a loop with no controls is the background-video shape. */
export const VideoAutoPlay: Story = {
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <G.Video title="A background loop" sources={[{ src: '/media/clip.webm', type: 'video/webm' }]} autoPlay loop controls={false} ratio="1:1" loading="eager" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const video = boxOf(canvasElement, 'video') as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.controls).toBe(false);
    expect(video.loop).toBe(true);
  },
};

/** Auto-pick by type and capability is a pure choice: the first source, in the author's order, the browser can play. */
export const VideoSourcePick: Story = {
  render: () => <G.Text>The pick is proven in the play function against injected browser capabilities.</G.Text>,
  play: async () => {
    const sources = [
      { type: 'application/dash+xml', src: 'a.mpd' },
      { type: 'application/vnd.apple.mpegurl', src: 'a.m3u8' },
      { type: 'video/webm', src: 'a.webm' },
      { type: 'video/mp4', src: 'a.mp4' },
    ] as const;
    const support = (playable: readonly string[], hasMediaSource: boolean) => ({ canPlayType: (type: string) => (playable.includes(type) ? 'probably' : ''), hasMediaSource });
    // Safari: native HLS (and mp4), no webm: the manifest of DASH needs MSE which Safari desktop has, so DASH is the first the author listed.
    expect(G.pickVideoSource(sources, support(['application/vnd.apple.mpegurl', 'video/mp4'], true))?.playback).toBe('dash.js');
    expect(G.pickVideoSource(sources.slice(1), support(['application/vnd.apple.mpegurl', 'video/mp4'], false))?.playback).toBe('native-hls');
    // Chromium: no native HLS; MSE present: hls.js reads the playlist.
    expect(G.pickVideoSource(sources.slice(1), support(['video/webm', 'video/mp4'], true))?.playback).toBe('hls.js');
    // No MSE and no native HLS: the first file the element itself plays.
    expect(G.pickVideoSource(sources.slice(1), support(['video/mp4'], false))).toMatchObject({ playback: 'native', source: { src: 'a.mp4' } });
    // Nothing playable.
    expect(G.pickVideoSource(sources, support([], false))).toBeNull();
    expect(G.pickVideoSource([], support(['video/webm'], true))).toBeNull();
  },
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
  play: async ({ canvasElement }) => {
    const frames = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="Video"]')];
    expect(frames).toHaveLength(2);
    const native = document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
    await waitFor(() => expect(frames[1]?.getAttribute('data-grammar-video-playback')).toBe('dash.js'), { timeout: 8000 });
    if (!native) await waitFor(() => expect(frames[0]?.getAttribute('data-grammar-video-playback')).toBe('hls.js'), { timeout: 8000 });
    // The fixture streams have no media segments: each ends in the in-place error notice, never a blank box.
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-grammar-video-notice="error"]').length).toBe(2), { timeout: 15000 });
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-grammar-video-notice="error"]')).not.toBeNull(), { timeout: 8000 });
    const unsupported = boxOf(canvasElement, '[data-grammar-video-notice="unsupported"]');
    expect(unsupported.textContent).toBe('Your browser cannot play this recording.');
    expect(unsupported.getAttribute('role')).toBe('status');
    const portrait = boxOf(canvasElement, '[data-grammar-video-ratio="9:16"]').getBoundingClientRect();
    expect(Math.abs(portrait.width / portrait.height - 9 / 16)).toBeLessThan(0.02);
  },
};

const HeroDemo = () => (
  <G.Grid
    kind="pair"
    leading={
      <G.Stack gap="section">
        <G.Heading level={1} scale="display">Plan the work, not the paperwork</G.Heading>
        <G.Text tone="muted">One calm place for your team to decide what happens next.</G.Text>
        <G.Cluster gap="inline"><G.Button intent="commit" size="lg">Start free</G.Button></G.Cluster>
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
  play: async ({ canvasElement }) => {
    const art = boxOf(canvasElement, '[data-component="Illustration"]');
    expect(art.getAttribute('aria-hidden')).toBe('true');
    expect(art.getAttribute('data-asset-slot')).toBe('landing.hero');
    const image = boxOf(art, 'img') as HTMLImageElement;
    expect(image.getAttribute('alt')).toBe('');
    const isCompact = window.matchMedia('(max-width: 47.999rem)').matches;
    await waitFor(() => expect(image.currentSrc.endsWith(isCompact ? '/media/art-compact.svg' : '/media/art-wide.svg')).toBe(true));
    const box = art.getBoundingClientRect();
    expect(Math.abs(box.width / box.height - (isCompact ? 4 / 3 : 21 / 9))).toBeLessThan(0.02);
  },
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
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-grammar-illustration-state="error"]')).not.toBeNull());
    const named = boxOf(canvasElement, '[data-component="Illustration"]:not([aria-hidden])');
    expect(boxOf(named, 'img').getAttribute('alt')).toBe('A team around a table');
    const banner = boxOf(canvasElement, '[data-grammar-illustration-ratio="21:9"]').getBoundingClientRect();
    expect(Math.abs(banner.width / banner.height - 21 / 9)).toBeLessThan(0.02);
  },
};
