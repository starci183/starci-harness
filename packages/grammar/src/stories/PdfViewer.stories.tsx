/// <reference types="vite/client" />
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as P from '../core/ext/pdf/index.js';
import { Matrix, State } from './fixtures.js';
import { buildFixturePdf, fixtureText } from './pdfFixture.js';

/**
 * The PDF extension (`@starci/grammar/core/ext/pdf`): `PdfViewer` draws a generated two-page fixture (built in code, nothing copyrighted) to a
 * canvas with pdfjs. Page navigation, zoom, fit to width, download, a text highlight and a rect highlight; loading is all Skeleton and a
 * file that cannot be opened is a Grammar Alert. Use it ONLY to show a PDF document. Shot at 1440 and 390.
 */
const meta: Meta = { title: 'Navigation & Data/Pdf viewer', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const bytes = buildFixturePdf();
const totalAt = fixtureText[0]!.indexOf('Total');
const highlights: readonly P.PdfHighlight[] = [
  { id: 'total', page: 1, start: totalAt, end: totalAt + 'Total ............. 500'.length, tone: 'success', note: 'The total' },
  { id: 'items', page: 1, rect: { x: 66, y: 160, width: 300, height: 52 }, tone: 'warning', note: 'Line items' },
];

const viewerOf = (root: HTMLElement, state: string) => root.querySelector<HTMLElement>(`[data-component="PdfViewer"][data-state="${state}"]`);
const painted = (canvas: HTMLCanvasElement): boolean => {
  const context = canvas.getContext('2d');
  if (context === null || canvas.width === 0) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < data.length; index += 4) if (data[index]! < 128) return true;
  return false;
};

/** A document: the counter, the page drawn, page navigation, zoom and fit to width, and two highlights on page one. */
export const Document: Story = {
  render: () => (
    <div style={{ width: 'min(100%, 720px)' }}>
      <P.PdfViewer source={bytes} ariaLabel="Sample document" fileName="sample.pdf" workerSrc={workerSrc} highlights={highlights} height={560} labels={{ fitWidth: 'Fit width' }} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const root = canvasElement;
    await waitFor(() => {
      const viewer = viewerOf(root, 'ready');
      expect(viewer).not.toBeNull();
      expect(painted(viewer!.querySelector('canvas')!)).toBe(true);
    }, { timeout: 15000 });
    const viewer = viewerOf(root, 'ready')!;
    const ui = within(viewer);
    expect(viewer.querySelector('[data-grammar-pdf-page-count]')!.textContent).toBe('1 / 2');
    expect(ui.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(ui.getByRole('button', { name: 'Fit width' }).getAttribute('aria-pressed')).toBe('true');
    // Fit to width: the page fills the area's content box.
    const area = viewer.querySelector<HTMLElement>('[data-grammar-pdf-area]')!;
    const page = viewer.querySelector<HTMLElement>('[data-grammar-pdf-page="ready"]')!;
    const inner = area.clientWidth - Number.parseFloat(getComputedStyle(area).paddingLeft) - Number.parseFloat(getComputedStyle(area).paddingRight);
    expect(Math.abs(page.getBoundingClientRect().width - inner)).toBeLessThanOrEqual(1);
    // The commands keep the 40 box at every width.
    for (const button of ui.getAllByRole('button')) expect(Math.round(button.getBoundingClientRect().height)).toBe(40);
    // Both highlights draw on page one, in their tones' soft pairs.
    await waitFor(() => expect(viewer.querySelectorAll('[data-grammar-pdf-highlight="total"]').length).toBeGreaterThan(0));
    expect(viewer.querySelector('[data-grammar-pdf-highlight="items"]')).not.toBeNull();
    const total = viewer.querySelector<HTMLElement>('[data-grammar-pdf-highlight="total"]')!.getBoundingClientRect();
    expect(total.width).toBeGreaterThan(0);
    expect(total.top).toBeGreaterThan(page.getBoundingClientRect().top);
  },
};

/** Navigation and zoom: next page, then zoom in leaves fit and widens the page; previous comes back. */
export const NavigateAndZoom: Story = {
  render: () => (
    <div style={{ width: 'min(100%, 720px)' }}>
      <P.PdfViewer source={bytes} ariaLabel="Sample document" workerSrc={workerSrc} height={420} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(viewerOf(canvasElement, 'ready')).not.toBeNull(), { timeout: 15000 });
    const viewer = viewerOf(canvasElement, 'ready')!;
    const ui = within(viewer);
    await waitFor(() => expect(viewer.querySelector('[data-grammar-pdf-page="ready"]')).not.toBeNull());
    await userEvent.click(ui.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(viewer.querySelector('[data-grammar-pdf-page-count]')!.textContent).toBe('2 / 2'));
    expect(ui.getByRole('button', { name: 'Next page' })).toBeDisabled();
    const before = viewer.querySelector('[data-grammar-pdf-page="ready"]')!.getBoundingClientRect().width;
    await userEvent.click(ui.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(viewer.querySelector('[data-grammar-pdf-page="ready"]')!.getBoundingClientRect().width).toBeGreaterThan(before));
    expect(ui.getByRole('button', { name: 'Fit width' }).getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(ui.getByRole('button', { name: 'Previous page' }));
    await waitFor(() => expect(viewer.querySelector('[data-grammar-pdf-page-count]')!.textContent).toBe('1 / 2'));
  },
};

/** Loading is all Skeleton in the ready box; a file that is not a PDF is a negative Alert with a retry. */
export const LoadingAndError: Story = {
  render: () => (
    <Matrix maxWidth={720}>
      <State label="Loading" direction="column">
        <P.PdfViewer source={bytes} ariaLabel="Sample document" workerSrc={workerSrc} height={320} isLoading />
      </State>
      <State label="Error" direction="column">
        <P.PdfViewer source={new TextEncoder().encode('not a pdf')} ariaLabel="Broken file" workerSrc={workerSrc} height={320} />
      </State>
    </Matrix>
  ),
  play: async ({ canvasElement }) => {
    const loading = viewerOf(canvasElement, 'loading')!;
    expect(loading).not.toBeNull();
    expect(loading.querySelectorAll('button').length).toBe(0);
    expect(loading.textContent?.trim()).toBe('');
    expect(loading.querySelector('[data-grammar-pdf-page="loading"] [data-component="Skeleton"]')).not.toBeNull();
    await waitFor(() => expect(viewerOf(canvasElement, 'error')).not.toBeNull(), { timeout: 15000 });
    const error = viewerOf(canvasElement, 'error')!;
    expect(within(error).getByRole('alert')).toBeTruthy();
    expect(within(error).getByText('The document could not be opened')).toBeTruthy();
    expect(within(error).getByRole('button', { name: 'Try again' })).toBeTruthy();
  },
};
