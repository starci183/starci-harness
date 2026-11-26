/// <reference types="vite/client" />
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as P from '../core/ext/pdf/index.js';
import { Matrix, State } from './fixtures.js';
import { buildFixturePdf, fixtureText } from './pdfFixture.js';

/**
 * The PDF extension (`@starci/grammar/core/ext/pdf`): `PdfViewer` draws a generated two-page fixture (built in code, nothing copyrighted) to a
 * canvas with pdfjs. Page navigation, zoom, fit to width, download, a text highlight and a rect highlight; loading is all Skeleton and a
 * file that cannot be opened is a Grammar Alert. Use it ONLY to show a PDF document.
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

/** A document: the counter, the page drawn, page navigation, zoom and fit to width, and two highlights on page one. */
export const Document: Story = {
  render: () => (
    <div style={{ width: 'min(100%, 720px)' }}>
      <P.PdfViewer source={bytes} ariaLabel="Sample document" fileName="sample.pdf" workerSrc={workerSrc} highlights={highlights} height={560} labels={{ fitWidth: 'Fit width' }} />
    </div>
  ),
};

/** Navigation and zoom: next page, then zoom in leaves fit and widens the page; previous comes back. */
export const NavigateAndZoom: Story = {
  render: () => (
    <div style={{ width: 'min(100%, 720px)' }}>
      <P.PdfViewer source={bytes} ariaLabel="Sample document" workerSrc={workerSrc} height={420} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const viewer = viewerOf(canvasElement, 'ready')!;
    const ui = within(viewer);
    await userEvent.click(ui.getByRole('button', { name: 'Next page' }));
    await userEvent.click(ui.getByRole('button', { name: 'Zoom in' }));
    await userEvent.click(ui.getByRole('button', { name: 'Previous page' }));
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
};
