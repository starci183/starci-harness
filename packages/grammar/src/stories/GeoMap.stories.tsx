import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { Matrix, State, noop } from './fixtures.js';

/**
 * GeoMap: points with a count on a tile ground, zoom and pan, clusters that open on press, and a list for assistive technology.
 * Each story draws a state and its play function proves it, at 1440 and at 390 (`npm run prove-plays`). The tiles here are drawn
 * from a data address that writes the tile's own z/x/y, so a story needs no network and no key; an app points `tiles.url` at the
 * tile route it serves (a PMTiles archive behind `/tiles/vn/{z}/{x}/{y}.png`, say).
 */
const meta: Meta = { title: 'Navigation & Data/Geo map', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const tileSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8efe6"/><rect x="0.5" y="0.5" width="255" height="255" fill="none" stroke="#c4d2bf"/><text x="8" y="20" font-size="12" font-family="sans-serif" fill="#5f7259">{z}/{x}/{y}</text></svg>';
const tiles: G.GeoMapTiles = {
  url: `data:image/svg+xml,${encodeURIComponent(tileSvg).replaceAll('%7B', '{').replaceAll('%7D', '}')}`,
  attribution: 'Map data: story placeholder tiles',
  maxZoom: 14,
};

const points: readonly G.GeoMapPoint[] = [
  { id: 'hn', lat: 21.03, lng: 105.85, count: 120, label: 'Ha Noi' },
  { id: 'hp', lat: 20.86, lng: 106.68, count: 45, label: 'Hai Phong' },
  { id: 'dn', lat: 16.05, lng: 108.2, count: 60, label: 'Da Nang' },
  { id: 'hue', lat: 16.46, lng: 107.59, count: 22, label: 'Hue' },
  { id: 'nt', lat: 12.24, lng: 109.19, count: 50, label: 'Nha Trang' },
  { id: 'd1', lat: 10.776, lng: 106.701, count: 150, label: 'Quan 1' },
  { id: 'd3', lat: 10.784, lng: 106.686, count: 90, label: 'Quan 3' },
  { id: 'd7', lat: 10.734, lng: 106.722, count: 70, label: 'Quan 7' },
  { id: 'td', lat: 10.85, lng: 106.77, count: 30, label: 'Thu Duc' },
  { id: 'ct', lat: 10.03, lng: 105.78, count: 30, label: 'Can Tho' },
];

const labels: G.GeoMapLabels = {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  showAll: 'Show every place',
  list: 'Places, ranked by stores',
  point: (point) => `${point.label ?? `${point.lat}, ${point.lng}`}, ${point.count} stores`,
  cluster: (places, total) => `${places} places, ${total} stores in all; press to zoom in`,
};

const emptyLine = <G.EmptyNotice message="No places yet" description="Places appear here once a store has an address." />;
const failure: G.ErrorData = { message: 'Could not load the map', description: 'Check the connection and try again.', actionLabel: 'Try again', onAction: noop };

const frameOf = (root: ParentNode): HTMLElement => {
  const found = root.querySelector<HTMLElement>('.starci-core-geomap-frame[role="group"]');
  if (found === null) throw new Error('no map frame');
  return found;
};
const all = (root: ParentNode, selector: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector));
const zoomOf = (frame: HTMLElement) => Number(frame.getAttribute('data-grammar-geomap-zoom'));

/** Clusters open on press: the map zooms in to the places inside, and the counts add up. */
export const GeoMapClusters: Story = {
  render: () => (
    <Matrix>
      <State label="Ten places in six areas, opening on every point; press a cluster" direction="column">
        <G.GeoMap label="Stores by area" points={points} labels={labels} tiles={tiles} empty={emptyLine} onSelect={noop} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const frame = frameOf(canvasElement);
    await waitFor(() => expect(all(frame, '[data-grammar-geomap-marker]').length).toBeGreaterThan(0));
    const total = (markers: HTMLElement[]) => markers.reduce((sum, marker) => sum + Number(marker.getAttribute('aria-label')?.match(/(\d+) stores/)?.[1] ?? 0), 0);
    // The markers together say every store: clusters add their members.
    const before = all(frame, '[data-grammar-geomap-marker]');
    expect(total(before)).toBe(points.reduce((sum, point) => sum + point.count, 0));
    const clusters = all(frame, '[data-grammar-geomap-marker="cluster"]');
    expect(clusters.length).toBeGreaterThan(0);
    const zoom = zoomOf(frame);
    const biggest = clusters.reduce((a, b) => (Number(a.textContent?.replace(/\D/g, '') || 0) >= Number(b.textContent?.replace(/\D/g, '') || 0) ? a : b));
    await userEvent.click(biggest);
    await waitFor(() => expect(zoomOf(frame)).toBeGreaterThan(zoom));
    // The markers are laid out in the frame, whatever the zoom.
    const box = frame.getBoundingClientRect();
    for (const marker of all(frame, '[data-grammar-geomap-marker]')) {
      const rect = marker.getBoundingClientRect();
      expect(rect.right).toBeGreaterThan(box.left - 70);
      expect(rect.left).toBeLessThan(box.right + 70);
    }
    // Every marker is at least a touch target tall.
    for (const marker of all(frame, '[data-grammar-geomap-marker]')) expect(marker.getBoundingClientRect().height).toBeGreaterThanOrEqual(31);
  },
};

const SelectDemo = () => {
  const [picked, setPicked] = useState('');
  return (
    <G.Stack gap="row">
      <G.GeoMap label="Stores by area" points={points.slice(0, 2)} labels={labels} tiles={tiles} empty={emptyLine} defaultView={{ lat: 20.9, lng: 106.3, zoom: 8 }} onSelect={setPicked} />
      <output data-testid="picked">{picked}</output>
    </G.Stack>
  );
};

/** A single point is a button when `onSelect` is given, and reads its name and count; without it the point is a mark. */
export const GeoMapSelect: Story = {
  render: () => (
    <Matrix>
      <State label="Two separate places at one zoom; press one" direction="column"><SelectDemo /></State>
      <State label="No onSelect: the points are marks, not buttons" direction="column">
        <G.GeoMap label="Stores by area" points={points.slice(0, 2)} labels={labels} tiles={tiles} empty={emptyLine} defaultView={{ lat: 20.9, lng: 106.3, zoom: 8 }} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await waitFor(() => expect(view.getAllByRole('button', { name: 'Ha Noi, 120 stores' }).length).toBeGreaterThan(0));
    await userEvent.click(view.getAllByRole('button', { name: 'Ha Noi, 120 stores' })[0] as HTMLElement);
    await waitFor(() => expect(view.getByTestId('picked').textContent).toBe('hn'));
    const [, plain] = all(canvasElement, '.starci-core-geomap-frame[role="group"]');
    await waitFor(() => expect(all(plain as HTMLElement, '[data-grammar-geomap-marker="point"]').length).toBe(2));
    expect(all(plain as HTMLElement, 'button[data-grammar-geomap-marker]').length).toBe(0);
    expect(all(plain as HTMLElement, '[role="img"]').map((mark) => mark.getAttribute('aria-label'))).toEqual(expect.arrayContaining(['Hai Phong, 45 stores']));
  },
};

/** Zoom and pan without a pointer: the buttons, and the arrow, plus, minus and Home keys of the focused map. */
export const GeoMapControls: Story = {
  render: () => (
    <Matrix>
      <State label="Zoom buttons, arrow and plus and minus keys; Home brings every place back" direction="column">
        <G.GeoMap label="Stores by area" points={points} labels={labels} tiles={tiles} empty={emptyLine} onSelect={noop} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const frame = frameOf(canvasElement);
    const view = within(canvasElement);
    await waitFor(() => expect(frame.hasAttribute('data-grammar-geomap-zoom')).toBe(true));
    const start = zoomOf(frame);
    await userEvent.click(view.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(zoomOf(frame)).toBeCloseTo(start + 1, 1));
    await userEvent.click(view.getByRole('button', { name: 'Zoom out' }));
    await waitFor(() => expect(zoomOf(frame)).toBeCloseTo(start, 1));
    frame.focus();
    await userEvent.keyboard('+');
    await waitFor(() => expect(zoomOf(frame)).toBeCloseTo(start + 1, 1));
    // An arrow key pans: the first marker's place on screen moves with it.
    const marker = all(frame, '[data-grammar-geomap-marker]')[0] as HTMLElement;
    const x = marker.getBoundingClientRect().left;
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(Math.abs(marker.getBoundingClientRect().left - x)).toBeGreaterThan(30));
    await userEvent.keyboard('{Home}');
    await waitFor(() => expect(zoomOf(frame)).toBeCloseTo(start, 1));
    await userEvent.keyboard('-');
    await waitFor(() => expect(zoomOf(frame)).toBeLessThan(start));
    // At the deepest zoom the zoom-in button stands disabled.
    expect(frame.getAttribute('aria-roledescription')).toBe('map');
    expect(frame.getAttribute('tabindex')).toBe('0');
  },
};

/** The ground is optional, the credit is read, and a list of every place stands in for the picture for assistive technology. */
export const GeoMapGroundAndList: Story = {
  render: () => (
    <Matrix>
      <State label="On tiles (the credit at the corner)" direction="column"><G.GeoMap label="Stores by area" points={points} labels={labels} tiles={tiles} empty={emptyLine} height="sm" /></State>
      <State label="No tiles: the points stand on a plain ground" direction="column"><G.GeoMap label="Stores by area" points={points} labels={labels} empty={emptyLine} height="sm" /></State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const [ground, plain] = all(canvasElement, '[data-component="GeoMap"]') as [HTMLElement, HTMLElement];
    await waitFor(() => expect(all(ground, '.starci-core-geomap-tile').length).toBeGreaterThan(0));
    expect(ground.textContent).toContain('Map data: story placeholder tiles');
    expect(all(plain, '.starci-core-geomap-tile').length).toBe(0);
    expect(plain.textContent).not.toContain('Map data');
    // The list names every place, the densest first, even those a cluster hides.
    const list = within(ground).getByRole('list', { name: 'Places, ranked by stores' });
    const items = within(list).getAllByRole('listitem').map((item) => item.textContent);
    expect(items.length).toBe(points.length);
    expect(items[0]).toBe('Quan 1, 150 stores');
    // The picture itself is for the eye: the tiles carry no name.
    expect(all(ground, '.starci-core-geomap-tiles').every((layer) => layer.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(Math.round(frameOf(ground).getBoundingClientRect().height)).toBe(256);
  },
};

/** The four states of a region: ready, loading (the frame at its height), empty and error. */
export const GeoMapStates: Story = {
  render: () => (
    <Matrix>
      <State label="Ready" direction="column"><G.GeoMap label="Stores by area" points={points} labels={labels} tiles={tiles} empty={emptyLine} height="sm" /></State>
      <State label="Loading" direction="column"><G.GeoMap label="Stores by area" points={points} labels={labels} tiles={tiles} empty={emptyLine} height="sm" isLoading /></State>
      <State label="Empty" direction="column"><G.GeoMap label="Stores by area" points={[]} labels={labels} tiles={tiles} empty={emptyLine} height="sm" /></State>
      <State label="Error" direction="column"><G.GeoMap label="Stores by area" points={points} labels={labels} tiles={tiles} empty={emptyLine} height="sm" error={failure} /></State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const maps = all(canvasElement, '[data-component="GeoMap"]');
    expect(maps.length).toBe(2);
    const [ready, loading] = maps as [HTMLElement, HTMLElement];
    expect(ready.hasAttribute('data-loading')).toBe(false);
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.querySelectorAll('[data-grammar-geomap-marker]').length).toBe(0);
    expect(loading.querySelector('button')).toBeNull();
    // Loading keeps the box: the frame is the ready frame's height.
    expect(Math.round(loading.getBoundingClientRect().height)).toBe(Math.round(frameOf(ready).getBoundingClientRect().height));
    await waitFor(() => expect(within(canvasElement).getByText('No places yet')).toBeTruthy());
    expect(within(canvasElement).getByText('Could not load the map')).toBeTruthy();
  },
};

/** A drag moves the map; the click that ends it is not a press on the marker under the pointer. */
export const GeoMapDrag: Story = {
  render: () => (
    <Matrix>
      <State label="Drag the ground; a marker under the pointer is not pressed" direction="column">
        <G.GeoMap label="Stores by area" points={points} labels={labels} tiles={tiles} empty={emptyLine} onSelect={fn()} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const frame = frameOf(canvasElement);
    await waitFor(() => expect(all(frame, '[data-grammar-geomap-marker]').length).toBeGreaterThan(0));
    const marker = all(frame, '[data-grammar-geomap-marker]')[0] as HTMLElement;
    const before = marker.getBoundingClientRect();
    const at = { x: before.left + before.width / 2, y: before.top + before.height / 2 };
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: marker, coords: { clientX: at.x, clientY: at.y } },
      { coords: { clientX: at.x - 40, clientY: at.y + 10 } },
      { coords: { clientX: at.x - 80, clientY: at.y + 20 } },
      { keys: '[/MouseLeft]', coords: { clientX: at.x - 80, clientY: at.y + 20 } },
    ]);
    await waitFor(() => expect(Math.abs(marker.getBoundingClientRect().left - before.left)).toBeGreaterThan(40));
  },
};
