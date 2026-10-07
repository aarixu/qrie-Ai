import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canSharePdf, deliverPdf } from '../src/deliver.ts';

/**
 * HANDING THE PDF OVER. Written first.
 *
 * On a phone, the share sheet (WhatsApp, say); anywhere else, or when sharing
 * is not possible, a plain download.
 */

const BYTES = new TextEncoder().encode('%PDF-1.3 test');

let clicked: { href: string; download: string }[];
let revoked: string[];

beforeEach(() => {
  vi.useFakeTimers();
  clicked = [];
  revoked = [];
  URL.createObjectURL = vi.fn(() => 'blob:report');
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubNavigator(share: ((data: ShareData) => Promise<void>) | undefined, canShare = true) {
  vi.stubGlobal('navigator', {
    ...navigator,
    share,
    canShare: share ? vi.fn(() => canShare) : undefined,
  });
}

describe('deliverPdf', () => {
  it('downloads through a temporary link, and lets the URL go afterwards', async () => {
    expect(await deliverPdf(BYTES, 'Riya-Sharma-8A-report.pdf', 'download', 'Report')).toBe('downloaded');
    expect(clicked).toEqual([{ href: 'blob:report', download: 'Riya-Sharma-8A-report.pdf' }]);
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers();
    expect(revoked).toEqual(['blob:report']);
  });

  it('shares the file as a PDF when the browser can', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    stubNavigator(share);
    expect(await deliverPdf(BYTES, 'r.pdf', 'share', 'Riya’s report')).toBe('shared');
    const data = share.mock.calls[0][0];
    expect(data.title).toBe('Riya’s report');
    expect(data.files?.[0].name).toBe('r.pdf');
    expect(data.files?.[0].type).toBe('application/pdf');
    expect(clicked).toEqual([]);
  });

  it('reports a share the user closed as cancelled, and downloads nothing', async () => {
    stubNavigator(async () => {
      throw new DOMException('closed', 'AbortError');
    });
    expect(await deliverPdf(BYTES, 'r.pdf', 'share', 'Report')).toBe('cancelled');
    expect(clicked).toEqual([]);
  });

  it('downloads instead when the share fails for any other reason', async () => {
    stubNavigator(async () => {
      throw new DOMException('no gesture', 'NotAllowedError');
    });
    expect(await deliverPdf(BYTES, 'r.pdf', 'share', 'Report')).toBe('downloaded');
    expect(clicked).toHaveLength(1);
  });

  it('downloads instead when the browser cannot share files', async () => {
    stubNavigator(vi.fn(async () => {}), false);
    expect(await deliverPdf(BYTES, 'r.pdf', 'share', 'Report')).toBe('downloaded');
    stubNavigator(undefined);
    expect(await deliverPdf(BYTES, 'r.pdf', 'share', 'Report')).toBe('downloaded');
    expect(clicked).toHaveLength(2);
  });
});

describe('canSharePdf', () => {
  it('asks the browser about a PDF file', () => {
    stubNavigator(vi.fn(async () => {}), true);
    expect(canSharePdf()).toBe(true);
    stubNavigator(vi.fn(async () => {}), false);
    expect(canSharePdf()).toBe(false);
    stubNavigator(undefined);
    expect(canSharePdf()).toBe(false);
  });
});
