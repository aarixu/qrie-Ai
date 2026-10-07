/**
 * HANDING A REPORT CARD OVER, IN THE BROWSER.
 *
 * 'share' opens the phone's share sheet with the PDF attached; where the
 * browser cannot share a file, or the share fails for any reason but the user
 * closing it, the PDF is downloaded instead.
 */

const PDF = 'application/pdf';

function pdfFile(bytes: Uint8Array, fileName: string): File {
  return new File([new Uint8Array(bytes)], fileName, { type: PDF });
}

/** Whether this browser can share a PDF file. */
export function canSharePdf(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [pdfFile(new Uint8Array(0), 'report.pdf')] });
  } catch {
    return false;
  }
}

function download(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: PDF }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Not at once: the click only starts the download, which still reads the URL.
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}

export async function deliverPdf(
  bytes: Uint8Array,
  fileName: string,
  how: 'download' | 'share',
  title: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (how === 'share' && typeof navigator !== 'undefined') {
    const file = pdfFile(bytes, fileName);
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return 'shared';
      } catch (err) {
        if ((err as { name?: unknown } | null)?.name === 'AbortError') return 'cancelled';
      }
    }
  }
  download(bytes, fileName);
  return 'downloaded';
}
